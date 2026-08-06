/**
 * OB→OBM transition checklist (Task #54)
 *
 * GET   /api/leads/:leadId/ob-obm-checklist                 — get checklist state
 * PATCH /api/leads/:leadId/ob-obm-checklist                 — update timeline dates /
 *                                                               welcome-document items
 * POST  /api/leads/:leadId/ob-obm-checklist/send-obm-mail   — validate, send OBM mail,
 *                                                               mark complete, and advance
 *                                                               the lead to
 *                                                               ONBOARDING_MEETING.
 *
 * The checklist is auto-created when a lead enters ONBOARDING (either via
 * PD→OB's send-welcome-mail action, or as a safety net in routes/leads.ts).
 * Its `completedAt` gates ONBOARDING → ONBOARDING_MEETING
 * (config/stageRequirements.ts, type 'obObmChecklist'). NPS triggering itself
 * happens via the shared POST /api/leads/:id/nps-trigger endpoint.
 *
 * send-obm-mail requires all 7 timeline dates to be filled in, all 7
 * welcome-document items marked done, NPS triggered, and the ONBOARDING-stage
 * Generated Quote file uploaded — see the `missing` checks below.
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';
import { sendEmail } from '../lib/email.js';
import { isAuthorizedForLead } from '../lib/leadAuth.js';
import { renderMailTemplate } from '../lib/mailTemplates.js';

export const obObmChecklistRouter = Router({ mergeParams: true });

const DOC_ITEMS = [
  'dexMaterial', 'creditSystem', 'deepCleaning', 'paymentProcess',
  'warrantyClaim', 'continuity', 'cancellation',
] as const;
type DocItem = typeof DOC_ITEMS[number];

const DOC_ITEM_LABELS: Record<DocItem, string> = {
  dexMaterial: 'Dex material / specification',
  creditSystem: 'Credit system',
  deepCleaning: 'Deep cleaning',
  paymentProcess: 'Payment process',
  warrantyClaim: 'Warranty claim',
  continuity: 'Project continuity / team transition',
  cancellation: 'Cancellation policy',
};

const TIMELINE_FIELDS = [
  'siteDocumentationAt', 'initialSiteDiscussionAt', 'layoutFinalisationAt',
  'designDiscussionAt', 'preSignOffAt', 'maskingAt', 'signOffAt',
] as const;
type TimelineField = typeof TIMELINE_FIELDS[number];

const TIMELINE_LABELS: Record<TimelineField, string> = {
  siteDocumentationAt: 'Site documentation date',
  initialSiteDiscussionAt: 'Initial site discussion date',
  layoutFinalisationAt: 'Layout finalisation date',
  designDiscussionAt: 'Design discussion date',
  preSignOffAt: 'Pre sign-off date',
  maskingAt: 'Masking date',
  signOffAt: 'Sign off date',
};

/** Admin-configurable default (see lib/mailTemplates.ts, code OB_OBM_WELCOME). */
export async function obmMailTemplate(clientName: string): Promise<{ subject: string; html: string }> {
  return renderMailTemplate('OB_OBM_WELCOME', { clientName });
}

async function loadLeadForChecklist(leadId: string, user: { id: string; role: string }) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, leadId: true, name: true, email: true, stage: true,
      assignedDesignerId: true, assignedBLId: true,
    },
  });
  if (!lead) return { lead: null, authorized: false };
  const authorized = await isAuthorizedForLead(lead, user);
  return { lead, authorized };
}

function allDocsDone(c: Record<string, any>): boolean {
  return DOC_ITEMS.every((item) => c[`${item}Done`]);
}

// ── GET /api/leads/:leadId/ob-obm-checklist ───────────────────────────────────
obObmChecklistRouter.get('/', verifyToken, async (req, res) => {
  try {
    const { leadId } = req.params as { leadId: string };
    const { lead, authorized } = await loadLeadForChecklist(leadId, req.user!);
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!authorized) { res.status(403).json({ error: 'Not authorised for this lead' }); return; }

    const checklist = await prisma.oBOBMChecklist.findUnique({ where: { leadId } });
    const welcomeMailScreenshot = await prisma.leadFile.findFirst({
      where: { leadId, fileType: 'WELCOME_MAIL_SCREENSHOT' },
      select: { id: true },
    });
    res.json({
      checklist: checklist ?? null,
      docItems: DOC_ITEMS.map((key) => ({ key, label: DOC_ITEM_LABELS[key] })),
      timelineFields: TIMELINE_FIELDS,
      obmMailTemplate: await obmMailTemplate(lead.name),
      hasWelcomeMailScreenshot: !!welcomeMailScreenshot,
    });
  } catch (err: any) {
    console.error('[ob-obm-checklist:get]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:leadId/ob-obm-checklist ─────────────────────────────────
obObmChecklistRouter.patch('/', verifyToken, async (req, res) => {
  try {
    const { leadId } = req.params as { leadId: string };
    const { lead, authorized } = await loadLeadForChecklist(leadId, req.user!);
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!authorized) { res.status(403).json({ error: 'Not authorised for this lead' }); return; }

    const current = await prisma.oBOBMChecklist.findUnique({ where: { leadId } });
    if (!current) {
      res.status(404).json({ error: 'OB→OBM checklist not found. Lead may not be in Onboarding stage yet.' });
      return;
    }
    if (current.completedAt) {
      res.status(400).json({ error: 'Checklist already completed — the OBM mail has been sent and the lead has moved to Onboarding Meeting.' });
      return;
    }

    const body = req.body as Record<string, any>;
    const data: Record<string, any> = {};

    for (const field of TIMELINE_FIELDS) {
      if (body[field] !== undefined) {
        data[field] = body[field] ? new Date(body[field]) : null;
      }
    }
    for (const item of DOC_ITEMS) {
      const doneKey = `${item}Done`;
      const confirmedKey = `${item}Confirmed`;
      if (body[doneKey] !== undefined) data[doneKey] = !!body[doneKey];
      if (body[confirmedKey] !== undefined) data[confirmedKey] = !!body[confirmedKey];
    }
    if (body.welcomeMailApprovedByClient !== undefined) {
      data.welcomeMailApprovedByClient = !!body.welcomeMailApprovedByClient;
    }

    const checklist = await prisma.oBOBMChecklist.update({ where: { leadId }, data });
    await logActivity(req.user!.id, 'OB_OBM_CHECKLIST_UPDATED', leadId, data);

    res.json({ checklist });
  } catch (err: any) {
    console.error('[ob-obm-checklist:patch]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/:leadId/ob-obm-checklist/send-obm-mail ───────────────────
obObmChecklistRouter.post('/send-obm-mail', verifyToken, async (req, res) => {
  try {
    const { leadId } = req.params as { leadId: string };
    const user = req.user!;
    const { lead, authorized } = await loadLeadForChecklist(leadId, user);
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!authorized) { res.status(403).json({ error: 'Not authorised for this lead' }); return; }

    if (lead.stage !== 'ONBOARDING') {
      res.status(400).json({ error: `Lead must be in Onboarding stage (currently ${lead.stage}).` });
      return;
    }

    const checklist = await prisma.oBOBMChecklist.findUnique({ where: { leadId } });
    if (!checklist) { res.status(404).json({ error: 'OB→OBM checklist not found.' }); return; }
    if (checklist.completedAt) { res.status(400).json({ error: 'OBM mail already sent.' }); return; }

    const [generatedQuote, welcomeMailScreenshot] = await Promise.all([
      prisma.leadFile.findFirst({
        where: { leadId, fileType: 'GENERATED_QUOTE', stage: 'ONBOARDING' },
        select: { id: true },
      }),
      prisma.leadFile.findFirst({
        where: { leadId, fileType: 'WELCOME_MAIL_SCREENSHOT' },
        select: { id: true },
      }),
    ]);

    const missing: string[] = [];
    if (!generatedQuote) missing.push('Generated quote document (Files → OB)');
    if (!checklist.welcomeMailApprovedByClient) missing.push('Welcome mail approved by client');
    if (!welcomeMailScreenshot) missing.push('Welcome mail approval screenshot (Files tab)');
    if (!allDocsDone(checklist)) {
      for (const item of DOC_ITEMS) {
        if (!(checklist as any)[`${item}Done`]) missing.push(DOC_ITEM_LABELS[item]);
      }
    }
    for (const f of TIMELINE_FIELDS) {
      if (!(checklist as any)[f]) missing.push(TIMELINE_LABELS[f]);
    }
    if (!checklist.npsTriggered) missing.push('NPS survey triggered');
    if (!lead.email) missing.push("Client's email address");
    if (missing.length) {
      res.status(400).json({ error: 'Cannot send OBM mail — missing requirements', missing });
      return;
    }

    const { subject, html } = req.body as { subject?: string; html?: string };
    const template = await obmMailTemplate(lead.name);
    const emailPayload = { to: lead.email!, subject: subject?.trim() || template.subject, html: html?.trim() || template.html };

    await sendEmail(emailPayload);
    await prisma.emailLog.create({
      data: { leadId, type: 'OB_OBM_WELCOME', sentTo: lead.email!, subject: emailPayload.subject },
    });

    const now = new Date();
    const [updatedChecklist] = await prisma.$transaction([
      prisma.oBOBMChecklist.update({
        where: { leadId },
        data: { obmMailSent: true, obmMailSentAt: now, completedAt: now },
      }),
      prisma.lead.update({ where: { id: leadId }, data: { stage: 'ONBOARDING_MEETING' } }),
      prisma.dIPChecklist.upsert({ where: { leadId }, create: { leadId }, update: {} }),
    ]);

    await logActivity(user.id, 'STAGE_CHANGED', leadId, { from: 'ONBOARDING', to: 'ONBOARDING_MEETING', isBackward: false });
    await logActivity(user.id, 'OB_OBM_MAIL_SENT', leadId, { subject: emailPayload.subject });

    const notifyId = lead.assignedBLId ?? lead.assignedDesignerId;
    if (notifyId) {
      await createNotification(
        notifyId,
        'ONBOARDING_DIP_REQUIRED',
        `Lead ${lead.leadId} reached Onboarding Meeting — complete DIP checklist to move to Design in Progress`,
        leadId,
      ).catch(() => {});
    }

    res.json({ checklist: updatedChecklist, stage: 'ONBOARDING_MEETING' });
  } catch (err: any) {
    console.error('[ob-obm-checklist:send-obm-mail]', err.message);
    res.status(500).json({ error: err.message });
  }
});
