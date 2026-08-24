/**
 * NPS helper — creates an NPSResponse record and queues the survey email.
 *
 * Idempotency contract:
 * - A unique constraint on (leadId, stage) guarantees at most one record per lead/stage.
 * - sentAt IS NULL  → record exists but email not yet queued (retryable).
 * - sentAt IS NOT NULL → email was successfully enqueued; skip completely.
 * - sentAt is only written AFTER the BullMQ job is accepted, so queue failures
 *   leave sentAt null and the next trigger will retry.
 * - BullMQ job ID is deterministic (nps-<leadId>-<stage>) so concurrent enqueues
 *   produce at most one queued job even if the DB write races.
 */
import { randomUUID } from 'crypto';
import { prisma } from './prisma.js';
import { renderMailTemplate } from './mailTemplates.js';
import { queues } from '../jobs/index.js';
import { resolveBaseUrl as resolveBaseUrlShared } from './baseUrl.js';

const NPS_STAGE_LABELS: Record<string, string> = {
  SALE: 'Sales',
  ONBOARDING: 'Onboarding',
  DESIGN_FREEZE: 'Design Freeze',
  SIGN_OFF: 'Sign Off',
};

/** Same resolution as {@link resolveBaseUrlShared}, but warns with NPS-specific context when unset. */
function resolveBaseUrl(): string | null {
  const url = resolveBaseUrlShared();
  if (!url) console.warn('[nps] Neither BASE_URL nor REPLIT_DEV_DOMAIN is configured — NPS survey email will not be sent.');
  return url;
}

/**
 * Create an NPS record (if needed) and queue the survey email.
 *
 * The (leadId, stage) unique constraint enforces one record per milestone.
 * An upsert-style approach is used: find the existing record, or create one, then
 * enqueue if sentAt is still null. The deterministic BullMQ job ID prevents
 * duplicate emails even when concurrent requests race past the DB check.
 */
export async function createAndSendNps(leadId: string, npsStage: string): Promise<void> {
  try {
    // ── 1. Find or create the record (unique constraint prevents duplicates) ───
    let record = await prisma.nPSResponse.findUnique({
      where: { leadId_stage: { leadId, stage: npsStage } },
      select: { id: true, formToken: true, sentAt: true },
    });

    if (!record) {
      try {
        record = await prisma.nPSResponse.create({
          data: { leadId, stage: npsStage, formToken: randomUUID() },
          select: { id: true, formToken: true, sentAt: true },
        });
      } catch (createErr: any) {
        // Unique constraint violation: a concurrent request created the record first.
        // Re-fetch and continue — do not abort.
        if (createErr.code === 'P2002') {
          record = await prisma.nPSResponse.findUnique({
            where: { leadId_stage: { leadId, stage: npsStage } },
            select: { id: true, formToken: true, sentAt: true },
          });
          if (!record) return; // Unexpected; give up.
        } else {
          throw createErr;
        }
      }
    }

    // ── 2. Idempotency: skip if email was already successfully enqueued ────────
    if (record.sentAt != null) return;

    // ── 3. Resolve lead contact details ───────────────────────────────────────
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        name: true,
        email: true,
        assignedDesigner: { select: { name: true } },
      },
    });
    if (!lead) return;

    if (!lead.email) {
      console.warn(`[nps] Lead ${leadId} has no email; NPS record created but survey email not sent`);
      return;
    }

    const baseUrl = resolveBaseUrl();
    if (!baseUrl) {
      // Record created / exists — email cannot be sent without a public URL.
      // sentAt remains null so the next trigger will retry.
      return;
    }

    // ── 4. Build email payload ─────────────────────────────────────────────────
    const ratingUrl = `${baseUrl}/nps/${record.formToken}`;
    const stageName = NPS_STAGE_LABELS[npsStage] ?? npsStage;

    const scores = Array.from({ length: 11 }, (_, i) => i);
    const scoreLinksHtml = scores.map((i) => {
      const bg = i <= 6 ? '#f0ece8' : i <= 8 ? '#f59e0b' : '#22c55e';
      const color = i <= 6 ? '#6b7280' : '#fff';
      return `<a href="${ratingUrl}?score=${i}" style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:${bg};color:${color};border-radius:8px;text-decoration:none;margin:2px;font-size:13px;font-weight:700">${i}</a>`;
    }).join('');

    const rendered = await renderMailTemplate('NPS_SURVEY', {
      clientName: lead.name,
      stageName,
      ratingUrl,
      scoreLinksHtml,
    });
    const emailPayload = { to: lead.email, subject: rendered.subject, html: rendered.html };

    // ── 5. Enqueue with a deterministic job ID to prevent BullMQ duplicates ───
    // BullMQ's `jobId` option deduplicates: a job with the same ID that is already
    // waiting/active will not be added again, even under concurrent callers.
    await queues.emails.add(
      `nps-survey-${npsStage.toLowerCase()}`,
      { emailPayload, leadId },
      { jobId: `nps-${leadId}-${npsStage}` },
    );

    // ── 6. Mark sentAt only after successful enqueue (retry gate) ─────────────
    await prisma.nPSResponse.update({
      where: { formToken: record.formToken },
      data: { sentAt: new Date() },
    });

    // ── 7. Audit log ───────────────────────────────────────────────────────────
    await prisma.emailLog.create({
      data: {
        leadId,
        type: `NPS_${npsStage}`,
        sentTo: lead.email,
        subject: emailPayload.subject,
      },
    });
  } catch (e) {
    // Log the error so operators can observe and retry; do not swallow silently.
    // sentAt remains null, so the next completion trigger will retry automatically.
    console.error(`[nps] Failed to queue NPS survey for lead ${leadId} stage ${npsStage}:`, (e as Error).message);
  }
}
