// ── Lead status actions (task #88) ────────────────────────────────────────────
// Shared logic for moving a lead between ACTIVE / ON_HOLD / INACTIVE, and back.
// `status` is decoupled from `stage` — placing a lead on hold or marking it
// inactive never touches `stage`, so the lead's real funnel position is
// preserved and both can be displayed together (e.g. "DQL — On Hold").
//
// Used by:
//   - PATCH /api/leads/:id/status  (manual On Hold / Inactive)
//   - POST  /api/leads/:id/reactivate  (manual reactivation)
//   - jobs/midnightOverdueTask.ts  (auto-reactivation when the reopen date arrives)
// Keeping the reactivation logic in one place means the manual and automatic
// paths can never diverge.
import { randomUUID } from 'crypto';
import { prisma } from './prisma.js';
import { logActivity } from './activityLog.js';
import { createNotification } from './notifications.js';
import { sendSms } from '../services/smsService.js';
import {
  sendEmail, inactivationEmail, onHoldEmail, onHoldInternalEmail, inactiveInternalEmail,
  leadReactivatedInternalEmail, leadReactivatedClientEmail,
} from './email.js';
import { sendWhatsAppMessage, fillTemplate } from './whatsapp.js';

async function internalRecipientsFor(lead: { assignedBLId: string | null; assignedDesignerId: string | null }) {
  const ids = new Set<string>();
  if (lead.assignedBLId) ids.add(lead.assignedBLId);
  if (lead.assignedDesignerId) ids.add(lead.assignedDesignerId);
  const managers = await prisma.user.findMany({ where: { role: { in: ['BL', 'BRANCH_HEAD'] }, isActive: true }, select: { id: true } });
  for (const m of managers) ids.add(m.id);
  return prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, email: true } });
}

// ── Place a lead On Hold ───────────────────────────────────────────────────────
export async function putLeadOnHold(opts: {
  leadId: string;
  actorId: string;
  actorName: string;
  reason: string;
  revivalDate: Date;
}) {
  const { leadId, actorId, actorName, reason, revivalDate } = opts;
  const existing = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!existing) throw new Error('Lead not found');

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: 'ON_HOLD',
      onHoldReason: reason,
      onHoldRevivalDate: revivalDate,
    },
  });

  await logActivity(actorId, 'STATUS_CHANGED', leadId, { from: existing.status, to: 'ON_HOLD', reason });

  const revivalStr = revivalDate.toLocaleDateString('en-IN');

  if (existing.phone) {
    sendSms(
      existing.phone,
      `Hi ${existing.name}, your Interiors by DeX project has been put on hold until ${revivalStr}. We'll be in touch. - Interiors by DeX`,
      leadId,
    ).catch((e) => console.warn('[leadStatus:sms:on_hold]', e.message));

    if (existing.email) {
      try {
        const emailPayload = onHoldEmail({ clientName: existing.name, revivalDate: revivalStr, reason });
        emailPayload.to = existing.email;
        await sendEmail(emailPayload);
        await prisma.emailLog.create({ data: { leadId, type: 'ON_HOLD', sentTo: existing.email, subject: emailPayload.subject } });
      } catch (e) {
        console.error('[ON_HOLD email failed]', e);
      }
    }

    try {
      const waBody = fillTemplate('on_hold_notification', { clientName: existing.name, revivalDate: revivalStr, reason });
      const twilioSid = await sendWhatsAppMessage(existing.phone, waBody);
      if (twilioSid) {
        await prisma.whatsAppMessage.create({
          data: { leadId, direction: 'OUTBOUND', body: waBody, templateId: 'on_hold_notification', twilioSid },
        });
      }
    } catch (e) {
      console.error('[ON_HOLD whatsapp failed]', e);
    }
  }

  // Mandatory internal notification
  const internalTargets = await internalRecipientsFor(existing);
  const msg = `Lead ${existing.leadId} (${existing.name}) placed On Hold by ${actorName}. Reopens ${revivalStr}.`;
  for (const t of internalTargets) {
    await createNotification(t.id, 'LEAD_ON_HOLD', msg, leadId).catch(() => {});
    const payload = onHoldInternalEmail({
      recipientName: t.name, leadId: existing.leadId, leadName: existing.name,
      revivalDate: revivalStr, reason, movedByName: actorName,
    });
    payload.to = t.email;
    sendEmail(payload).catch(() => {});
  }

  return lead;
}

// ── Mark a lead Inactive ───────────────────────────────────────────────────────
export async function markLeadInactive(opts: {
  leadId: string;
  actorId: string;
  actorName: string;
  reason: string;
  notes?: string;
  notifyClient: boolean;
}) {
  const { leadId, actorId, actorName, reason, notes } = opts;
  // Client notification is an agreed inactive-lead workflow, not an optional
  // UI preference. Deliver through every available client channel.
  const notifyClient = true;
  const existing = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!existing) throw new Error('Lead not found');

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: 'INACTIVE',
      inactiveReason: reason,
      inactiveNotes: notes?.trim() || null,
    },
  });

  // Mirrors the terminal-stage SLA-breach auto-resolve in routes/leads.ts —
  // an inactive lead should never keep carrying a stale breach flag.
  await prisma.sLABreach.updateMany({ where: { leadId, resolvedAt: null }, data: { resolvedAt: new Date() } });
  await prisma.lead.update({ where: { id: leadId }, data: { isSLABreached: false } });

  await logActivity(actorId, 'STATUS_CHANGED', leadId, {
    from: existing.status, to: 'INACTIVE', reason, notes: notes?.trim() || undefined, notifiedClient: notifyClient,
  });

  // Client-facing feedback form — only when explicitly opted in (task #88).
  if (notifyClient) {
    const formToken = randomUUID();
    const baseUrl = process.env.BASE_URL ?? '';
    const feedbackUrl = `${baseUrl}/feedback/${formToken}`;

    await prisma.inactivationFeedback.upsert({
      where: { leadId },
      create: { leadId, reason, formToken, feedbackFormSentAt: new Date() },
      update: { reason, formToken, feedbackFormSentAt: new Date(), respondedAt: null, clientResponse: null },
    });

    if (existing.email) {
      const emailPayload = inactivationEmail({ clientName: existing.name, feedbackUrl, reason });
      emailPayload.to = existing.email;
      sendEmail(emailPayload).catch((e) => console.warn('[leadStatus:email:inactive]', e.message));
      await prisma.emailLog.create({ data: { leadId, type: 'INACTIVATION_FEEDBACK', sentTo: existing.email, subject: emailPayload.subject } });
    }

    if (existing.phone) {
      sendSms(
        existing.phone,
        `Hi ${existing.name}, thank you for your interest in Interiors by DeX. We'd love your feedback: ${feedbackUrl} - Interiors by DeX`,
        leadId,
      ).catch((e) => console.warn('[leadStatus:sms:inactive]', e.message));
    }
  }

  // Mandatory internal notification
  const internalTargets = await internalRecipientsFor(existing);
  const msg = `Lead ${existing.leadId} (${existing.name}) marked Inactive by ${actorName}. Reason: ${reason}`;
  for (const t of internalTargets) {
    await createNotification(t.id, 'LEAD_INACTIVATED', msg, leadId).catch(() => {});
    const payload = inactiveInternalEmail({
      recipientName: t.name, leadId: existing.leadId, leadName: existing.name, reason, movedByName: actorName,
    });
    payload.to = t.email;
    sendEmail(payload).catch(() => {});
  }

  return lead;
}

// ── Reactivate a lead (manual or automatic) ───────────────────────────────────
export async function reactivateLead(opts: {
  leadId: string;
  actorId: string;
  actorName: string;
  reason: string;
  notes?: string;
  notifyClient: boolean;
}) {
  const { leadId, actorId, actorName, reason, notes } = opts;
  const notifyClient = true;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error('Lead not found');
  if (lead.status !== 'ON_HOLD' && lead.status !== 'INACTIVE') {
    throw new Error('Only leads that are On Hold or Inactive can be reactivated.');
  }

  const fromStatus = lead.status === 'ON_HOLD' ? 'On Hold' : 'Inactive';

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: 'ACTIVE',
      onHoldRevivalDate: null,
      onHoldReason: null,
      inactiveReason: null,
      inactiveNotes: null,
    },
    include: {
      assignedDesigner: { select: { id: true, name: true, role: true } },
      assignedBL: { select: { id: true, name: true } },
    },
  });

  await logActivity(actorId, 'LEAD_REACTIVATED', leadId, {
    from: fromStatus, reason: reason.trim(), notes: notes?.trim() || undefined, notifiedClient: notifyClient,
  });

  const internalTargets = await internalRecipientsFor(lead);
  const msg = `Lead ${lead.leadId} (${lead.name}) reactivated from ${fromStatus} by ${actorName}. Reason: ${reason.trim()}`;
  for (const t of internalTargets) {
    await createNotification(t.id, 'LEAD_REACTIVATED', msg, leadId).catch(() => {});
    const payload = leadReactivatedInternalEmail({
      recipientName: t.name, leadId: lead.leadId, leadName: lead.name,
      fromStatus, reason: reason.trim(), notes: notes?.trim(), reactivatedByName: actorName,
    });
    payload.to = t.email;
    sendEmail(payload).catch(() => {});
  }

  if (notifyClient && lead.email) {
    const payload = leadReactivatedClientEmail({ clientName: lead.name, notes: notes?.trim() });
    payload.to = lead.email;
    sendEmail(payload).catch(() => {});
  }

  return updated;
}
