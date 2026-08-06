import { Router } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { logActivity } from '../lib/activityLog.js';

import { isValidEmail, isValidPhone } from '../lib/leadValidation.js';
import { selectCREForLead, incrementAssigned } from '../services/assignmentService.js';

export const leadWebhooksRouter = Router();

// projectType/scope/location are intentionally NOT required for webhook-sourced
// leads — ad-form leads (Meta/Google) never collect them upfront; a CRE fills
// them in once they make contact. Phone/email format is still enforced below.

const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID ?? 'system';
const META_APP_SECRET = process.env.META_APP_SECRET ?? '';

// The 'system' placeholder isn't a real user row (no SYSTEM_USER_ID env var is
// configured), so activity logs for webhook-created leads would otherwise fail
// their FK constraint and silently vanish. Fall back to an active Branch Head
// so the assignment is still auditable in the lead's activity timeline.
let cachedSystemUserId: string | null = null;
async function resolveSystemUserId(): Promise<string> {
  if (SYSTEM_USER_ID !== 'system') return SYSTEM_USER_ID;
  if (cachedSystemUserId) return cachedSystemUserId;
  const bh = await prisma.user.findFirst({ where: { role: 'BRANCH_HEAD', isActive: true }, select: { id: true } });
  cachedSystemUserId = bh?.id ?? SYSTEM_USER_ID;
  return cachedSystemUserId;
}
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN ?? '';
const META_FORM_ID = process.env.META_FORM_ID ?? '';
const GRAPH_API = 'https://graph.facebook.com/v19.0';

// ── Auto-generate X#### lead ID ───────────────────────────────────────────────
async function generateLeadId(): Promise<string> {
  const counter = await prisma.$transaction(async (tx) => {
    return tx.leadCounter.upsert({
      where: { id: 1 },
      create: { id: 1, lastNum: 1 },
      update: { lastNum: { increment: 1 } },
    });
  });
  return `X${String(counter.lastNum).padStart(4, '0')}`;
}

// ── Create lead from parsed data ──────────────────────────────────────────────
async function createLeadFromWebhook(data: {
  name: string; phone: string; email?: string;
  source: string; utmCampaign?: string; utmSource?: string;
  adName?: string;
}): Promise<string | null> {
  if (!isValidPhone(data.phone)) {
    console.warn(`[webhook] Rejected lead with invalid phone "${data.phone}" from source ${data.source}`);
    return null;
  }
  if (data.email && !isValidEmail(data.email)) {
    console.warn(`[webhook] Rejected lead with invalid email "${data.email}" from source ${data.source}`);
    return null;
  }

  const existing = await prisma.lead.findFirst({ where: { phone: data.phone } });
  if (existing) return existing.id;

  // Ad-sourced leads are routed to a CRE for qualification first, in
  // round-robin order across active CREs — never left unassigned or handed
  // straight to a Business Lead.
  const cre = await selectCREForLead();

  const leadId = await generateLeadId();
  const lead = await prisma.lead.create({
    data: {
      leadId,
      name: data.name,
      phone: data.phone,
      email: data.email,
      source: data.source,
      adName: data.adName,
      utmCampaign: data.utmCampaign,
      utmSource: data.utmSource,
      stage: 'MQL',
      ...(cre && { assignedDesignerId: cre.id }),
    },
  });
  if (cre) await incrementAssigned(cre.id);
  await logActivity(await resolveSystemUserId(), 'LEAD_CREATED_VIA_WEBHOOK', lead.id, {
    source: data.source,
    leadId,
    ...(cre && { autoAssignedCREId: cre.id, autoAssignedCREName: cre.name }),
  });
  return lead.id;
}

// ── META LEAD ADS ─────────────────────────────────────────────────────────────

// GET /api/leads/webhook/meta — Meta verification
leadWebhooksRouter.get('/meta', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? 'interiorsbydex_meta_verify';
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[meta:webhook] Verification success');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ error: 'Verification failed' });
  }
});

// POST /api/leads/webhook/meta — receive lead gen notification
leadWebhooksRouter.post('/meta', async (req, res) => {
  // Verify HMAC-SHA256 signature
  if (META_APP_SECRET) {
    const sig = req.headers['x-hub-signature-256'] as string;
    const payload = (req as any).rawBody ?? JSON.stringify(req.body);
    const expected = `sha256=${crypto.createHmac('sha256', META_APP_SECRET).update(payload).digest('hex')}`;
    try {
      if (!sig || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    } catch {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  res.status(200).json({ status: 'ok' }); // ACK immediately

  // Process asynchronously
  setImmediate(async () => {
    try {
      const body = req.body as any;
      const entries = body?.entry ?? [];
      for (const entry of entries) {
        for (const change of entry?.changes ?? []) {
          if (change.field !== 'leadgen') continue;
          const leadgenId = change.value?.leadgen_id;
          if (!leadgenId) continue;
          if (META_FORM_ID && change.value?.form_id !== META_FORM_ID) continue;

          // Fetch lead data from Graph API
          const apiRes = await fetch(
            `${GRAPH_API}/${leadgenId}?access_token=${META_PAGE_ACCESS_TOKEN}`,
          );
          const leadData = await apiRes.json() as any;

          if (!apiRes.ok) {
            console.error('[meta:webhook] Graph API error:', leadData);
            continue;
          }

          const fieldMap: Record<string, string> = {};
          for (const f of leadData.field_data ?? []) {
            fieldMap[f.name.toLowerCase()] = f.values?.[0] ?? '';
          }

          const name = fieldMap['full_name'] || fieldMap['name'] || 'Unknown';
          const phone = fieldMap['phone_number'] || fieldMap['phone'] || '';
          if (!phone) { console.warn('[meta:webhook] No phone in lead:', leadgenId); continue; }

          await createLeadFromWebhook({
            name, phone,
            email: fieldMap['email'] || undefined,
            source: 'META_ADS',
            adName: change.value?.ad_name,
            utmCampaign: change.value?.campaign_name,
            utmSource: 'meta',
          });
          console.log(`[meta:webhook] Lead created for ${name} (${phone})`);
        }
      }
    } catch (e) {
      console.error('[meta:webhook] Processing error:', e);
    }
  });
});

// ── GOOGLE ADS (Zapier / direct webhook) ─────────────────────────────────────
leadWebhooksRouter.post('/google', async (req, res) => {
  res.status(200).json({ status: 'ok' });

  setImmediate(async () => {
    try {
      const b = req.body as Record<string, string>;
      const name = b.name || b.full_name || 'Unknown';
      const phone = b.phone || b.phone_number || b.mobile || '';

      if (!phone) { console.warn('[google:webhook] No phone provided'); return; }
      if (!isValidPhone(phone)) { console.warn(`[google:webhook] Rejected lead with invalid phone "${phone}"`); return; }
      if (b.email && !isValidEmail(b.email)) { console.warn(`[google:webhook] Rejected lead with invalid email "${b.email}"`); return; }

      const existing = await prisma.lead.findFirst({ where: { phone } });
      if (!existing) {
        // Round-robin across active CREs (fewest currently assigned leads first)
        // so ad leads are always qualified by a CRE before reaching a BL.
        const cre = await selectCREForLead();

        const leadId = await generateLeadId();
        const lead = await prisma.lead.create({
          data: {
            leadId,
            name, phone,
            email: b.email || undefined,
            source: 'GOOGLE_ADS',
            utmCampaign: b.utm_campaign || b.campaign_name || undefined,
            utmSource: b.utm_source || 'google',
            utmAdSet: b.utm_adset || undefined,
            location: b.city || b.location || undefined,
            stage: 'MQL',
            ...(cre && { assignedDesignerId: cre.id }),
          },
        });
        if (cre) await incrementAssigned(cre.id);
        await logActivity(await resolveSystemUserId(), 'LEAD_CREATED_VIA_WEBHOOK', lead.id, {
          source: 'GOOGLE_ADS',
          leadId,
          ...(cre && { autoAssignedCREId: cre.id, autoAssignedCREName: cre.name }),
        });
        console.log(`[google:webhook] Lead created: ${lead.leadId} for ${name}`);
      } else {
        console.log(`[google:webhook] Duplicate phone ${phone}, skipping`);
      }
    } catch (e) {
      console.error('[google:webhook] Error:', e);
    }
  });
});
