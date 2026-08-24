/**
 * PD→OB transition checklist (Task #54)
 *
 * GET   /api/leads/:leadId/pd-ob-checklist                     — get checklist state
 * PATCH /api/leads/:leadId/pd-ob-checklist                     — update checklist fields
 * POST  /api/leads/:leadId/pd-ob-checklist/send-welcome-mail   — validate, send welcome
 *                                                                 mail, mark complete, and
 *                                                                 advance the lead to
 *                                                                 ONBOARDING.
 *
 * The checklist is auto-created when a lead enters PROPOSAL_DISCUSSION (see
 * routes/leads.ts). Its `completedAt` gates PROPOSAL_DISCUSSION → ONBOARDING
 * (config/stageRequirements.ts, type 'pdObChecklist').
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';
import { sendEmail } from '../lib/email.js';
import { isAuthorizedForLead } from '../lib/leadAuth.js';
import { renderMailTemplate } from '../lib/mailTemplates.js';
import { assignLeadToDesigner, incrementAssigned } from '../services/assignmentService.js';
import { MEETING_LOCATION_TYPES } from '../lib/meetingScheduler.js';
import { isLeadLocked, sendLeadLockedError } from '../lib/leadLock.js';

export const pdObChecklistRouter = Router({ mergeParams: true });

/** Admin-configurable default (see lib/mailTemplates.ts, code PD_OB_WELCOME). */
export async function pdObWelcomeMailTemplate(clientName: string): Promise<{ subject: string; html: string }> {
  return renderMailTemplate('PD_OB_WELCOME', { clientName });
}

async function loadLeadForChecklist(leadId: string, user: { id: string; role: string }) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, leadId: true, name: true, email: true, stage: true,
      assignedDesignerId: true, assignedBLId: true, estimatedValue: true, status: true,
    },
  });
  if (!lead) return { lead: null, authorized: false };
  const authorized = await isAuthorizedForLead(lead, user);
  return { lead, authorized };
}

// ── GET /api/leads/:leadId/pd-ob-checklist ────────────────────────────────────
pdObChecklistRouter.get('/', verifyToken, async (req, res) => {
  try {
    const { leadId } = req.params as { leadId: string };
    const { lead, authorized } = await loadLeadForChecklist(leadId, req.user!);
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!authorized) { res.status(403).json({ error: 'Not authorised for this lead' }); return; }

    let checklist = await prisma.pDOBChecklist.findUnique({ where: { leadId } });
    // Self-healing safety net: a lead can be sitting in PROPOSAL_DISCUSSION (or
    // later) without a checklist row if it reached that stage before this
    // gate existed, or via any path that bypassed the leads.ts auto-create.
    // Without this, any entry point (Pipeline board or Lead Detail) shows a
    // permanent "not yet created" dead end instead of the actual checklist.
    const STAGES_PAST_PD = new Set(['PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS', 'HANDED_OVER']);
    if (!checklist && STAGES_PAST_PD.has(lead.stage)) {
      checklist = await prisma.pDOBChecklist.upsert({ where: { leadId }, create: { leadId }, update: {} });
    }

    // Uploaded-file status is sourced from LeadFile (single source of truth —
    // mirrors how stageRequirements.ts checks file gates).
    const [paymentScreenshot, obQuote, welcomeMailScreenshot, finalPitchPresentationFile, generatedQuotationFile] = await Promise.all([
      prisma.leadFile.findFirst({ where: { leadId, fileType: 'PAYMENT_SCREENSHOT' }, select: { id: true } }),
      prisma.leadFile.findFirst({ where: { leadId, fileType: 'OB_QUOTE' }, select: { id: true } }),
      // Task #84 — client approval-of-wording proof now belongs to the PD→OB
      // welcome mail (moved from OBOBMChecklist), scoped to this checklist's
      // own upload stage so it can't be satisfied by an OBM-stage screenshot.
      prisma.leadFile.findFirst({ where: { leadId, stage: 'PROPOSAL_DISCUSSION', fileType: 'WELCOME_MAIL_SCREENSHOT' }, select: { id: true } }),
      // These two mirror the exact checks send-welcome-mail enforces below —
      // previously absent from this GET response, so the "Share welcome mail"
      // button could appear enabled client-side and then fail server-side
      // with "missing: Final Pitch Presentation file" / "Generated Quotation
      // file" even though every visible checkbox/field was filled in.
      prisma.leadFile.findFirst({ where: { leadId, stage: 'PROPOSAL_DISCUSSION', fileType: 'PITCH_PRESENTATION' }, select: { id: true } }),
      prisma.leadFile.findFirst({ where: { leadId, stage: 'PROPOSAL_DISCUSSION', fileType: { in: ['QUOTATION', 'GENERATED_QUOTE'] } }, select: { id: true } }),
    ]);

    res.json({
      checklist: checklist ?? null,
      hasPaymentScreenshot: !!paymentScreenshot,
      hasObQuote: !!obQuote,
      hasWelcomeMailScreenshot: !!welcomeMailScreenshot,
      hasFinalPitchPresentationFile: !!finalPitchPresentationFile,
      hasGeneratedQuotationFile: !!generatedQuotationFile,
      welcomeMailTemplate: await pdObWelcomeMailTemplate(lead.name),
    });
  } catch (err: any) {
    console.error('[pd-ob-checklist:get]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:leadId/pd-ob-checklist ──────────────────────────────────
pdObChecklistRouter.patch('/', verifyToken, async (req, res) => {
  try {
    const { leadId } = req.params as { leadId: string };
    const { lead, authorized } = await loadLeadForChecklist(leadId, req.user!);
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!authorized) { res.status(403).json({ error: 'Not authorised for this lead' }); return; }
    if (isLeadLocked(lead.status)) { sendLeadLockedError(res); return; }

    const current = await prisma.pDOBChecklist.findUnique({ where: { leadId } });
    if (!current) {
      res.status(404).json({ error: 'PD→OB checklist not found. Lead may not be in Proposal Discussion stage yet.' });
      return;
    }
    if (current.completedAt) {
      res.status(400).json({ error: 'Checklist already completed — the welcome mail has been sent and the lead has moved to Onboarding.' });
      return;
    }

    const {
      paymentValue, projectValue, furnitureValue, obMeetingScheduledAt, obMeetingLocation, notes,
      finalPitchPresentationConfirmed,
    } = req.body as Record<string, any>;

    const data: Record<string, any> = {};
    if (paymentValue !== undefined) data.paymentValue = paymentValue === '' || paymentValue === null ? null : parseFloat(paymentValue);
    if (projectValue !== undefined) data.projectValue = projectValue === '' || projectValue === null ? null : parseFloat(projectValue);
    if (furnitureValue !== undefined) data.furnitureValue = furnitureValue === '' || furnitureValue === null ? null : parseFloat(furnitureValue);
    if (obMeetingScheduledAt !== undefined) data.obMeetingScheduledAt = obMeetingScheduledAt ? new Date(obMeetingScheduledAt) : null;
    if (obMeetingLocation !== undefined) {
      if (obMeetingLocation && !MEETING_LOCATION_TYPES.includes(obMeetingLocation as any)) {
        res.status(400).json({ error: `obMeetingLocation must be one of: ${MEETING_LOCATION_TYPES.join(', ')}` });
        return;
      }
      data.obMeetingLocation = obMeetingLocation || null;
    }
    if (notes !== undefined) data.notes = notes?.trim() || null;
    if (finalPitchPresentationConfirmed !== undefined) data.finalPitchPresentationConfirmed = !!finalPitchPresentationConfirmed;

    const checklist = await prisma.pDOBChecklist.update({ where: { leadId }, data });
    await logActivity(req.user!.id, 'PD_OB_CHECKLIST_UPDATED', leadId, data);

    res.json({ checklist });
  } catch (err: any) {
    console.error('[pd-ob-checklist:patch]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/:leadId/pd-ob-checklist/send-welcome-mail ────────────────
pdObChecklistRouter.post('/send-welcome-mail', verifyToken, async (req, res) => {
  try {
    const { leadId } = req.params as { leadId: string };
    const user = req.user!;
    const { lead, authorized } = await loadLeadForChecklist(leadId, user);
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!authorized) { res.status(403).json({ error: 'Not authorised for this lead' }); return; }
    if (isLeadLocked(lead.status)) { sendLeadLockedError(res); return; }

    if (lead.stage !== 'PROPOSAL_DISCUSSION') {
      res.status(400).json({ error: `Lead must be in Proposal Discussion stage (currently ${lead.stage}).` });
      return;
    }

    const checklist = await prisma.pDOBChecklist.findUnique({ where: { leadId } });
    if (!checklist) { res.status(404).json({ error: 'PD→OB checklist not found.' }); return; }
    if (checklist.completedAt) { res.status(400).json({ error: 'Welcome mail already sent.' }); return; }

    const [paymentScreenshot, obQuote, finalPitchPresentationFile, generatedQuotationFile, welcomeMailScreenshot] = await Promise.all([
      prisma.leadFile.findFirst({ where: { leadId, fileType: 'PAYMENT_SCREENSHOT' }, select: { id: true } }),
      prisma.leadFile.findFirst({ where: { leadId, fileType: 'OB_QUOTE' }, select: { id: true } }),
      // Both the Final Pitch Presentation AND the Generated Quotation are now
      // required together (previously either/or) — mirrors
      // stageRequirements.ts's PROPOSAL_DISCUSSION->ONBOARDING gate. This
      // direct transition (send-welcome-mail bypasses checkStageRequirements
      // entirely) must enforce the same minimum, or a lead could reach
      // Onboarding without both.
      prisma.leadFile.findFirst({
        where: { leadId, stage: 'PROPOSAL_DISCUSSION', fileType: 'PITCH_PRESENTATION' },
        select: { id: true },
      }),
      prisma.leadFile.findFirst({
        where: { leadId, stage: 'PROPOSAL_DISCUSSION', fileType: { in: ['QUOTATION', 'GENERATED_QUOTE'] } },
        select: { id: true },
      }),
      // Task #84: client approval-of-wording proof for THIS mail.
      prisma.leadFile.findFirst({ where: { leadId, stage: 'PROPOSAL_DISCUSSION', fileType: 'WELCOME_MAIL_SCREENSHOT' }, select: { id: true } }),
    ]);

    const missing: string[] = [];
    if (!paymentScreenshot) missing.push('Payment screenshot (Files tab)');
    if (!obQuote) missing.push('OB Quote (Files tab)');
    if (!finalPitchPresentationFile) missing.push('Final Pitch Presentation file (Files → Proposal Discussion)');
    if (!generatedQuotationFile) missing.push('Generated Quotation file (Files → Proposal Discussion)');
    if (checklist.paymentValue == null) missing.push('Payment value');
    if (checklist.projectValue == null) missing.push('Project value (excl. furniture)');
    if (checklist.furnitureValue == null) missing.push('Furniture value');
    if (!checklist.obMeetingScheduledAt) missing.push('OB meeting date/time');
    if (!checklist.obMeetingLocation) missing.push('OB meeting location');
    if (!checklist.notes || !checklist.notes.trim()) missing.push('Notes');
    if (!checklist.finalPitchPresentationConfirmed) missing.push('Final Pitch Presentation confirmed');
    if (!welcomeMailScreenshot) missing.push('Welcome mail approval screenshot (Files tab)');
    if (!lead.email) missing.push("Client's email address");
    if (missing.length) {
      res.status(400).json({ error: 'Cannot send welcome mail — missing requirements', missing });
      return;
    }

    const { subject, html } = req.body as { subject?: string; html?: string };
    const template = await pdObWelcomeMailTemplate(lead.name);
    const emailPayload = { to: lead.email!, subject: subject?.trim() || template.subject, html: html?.trim() || template.html };

    await sendEmail(emailPayload);
    await prisma.emailLog.create({
      data: { leadId, type: 'PD_OB_WELCOME', sentTo: lead.email!, subject: emailPayload.subject },
    });

    // Task #83 spec item 6: PD→OB completion must auto-assign a design
    // manager if the lead doesn't already have one. There's no separate
    // "design manager" role in the schema — the assigned designer becomes
    // the design manager once the project reaches Onboarding, so this reuses
    // the existing designer round-robin (assignmentService) rather than
    // introducing a new role/field.
    let assignedDesignManagerId: string | null = null;
    if (!lead.assignedDesignerId && lead.assignedBLId) {
      assignedDesignManagerId = await assignLeadToDesigner(
        lead.estimatedValue != null ? Number(lead.estimatedValue) : null,
        lead.assignedBLId,
      );
    }

    const now = new Date();
    const [updatedChecklist] = await prisma.$transaction([
      prisma.pDOBChecklist.update({
        where: { leadId },
        data: { welcomeMailSent: true, welcomeMailSentAt: now, completedAt: now },
      }),
      prisma.lead.update({
        where: { id: leadId },
        data: {
          stage: 'ONBOARDING',
          ...(assignedDesignManagerId && { assignedDesignerId: assignedDesignManagerId }),
        },
      }),
      prisma.oBOBMChecklist.upsert({ where: { leadId }, create: { leadId }, update: {} }),
    ]);

    if (assignedDesignManagerId) {
      await incrementAssigned(assignedDesignManagerId);
      await logActivity(user.id, 'DESIGN_MANAGER_ASSIGNED', leadId, { designManagerId: assignedDesignManagerId });
      await createNotification(
        assignedDesignManagerId,
        'DESIGNER_ASSIGNED',
        `You've been auto-assigned as design manager for lead ${lead.leadId}, now in Onboarding.`,
        leadId,
      ).catch(() => {});
    }

    await logActivity(user.id, 'STAGE_CHANGED', leadId, { from: 'PROPOSAL_DISCUSSION', to: 'ONBOARDING', isBackward: false });
    await logActivity(user.id, 'PD_OB_WELCOME_MAIL_SENT', leadId, { subject: emailPayload.subject });

    const notifyId = lead.assignedBLId ?? lead.assignedDesignerId;
    if (notifyId) {
      await createNotification(
        notifyId,
        'ONBOARDING_DIP_REQUIRED',
        `Lead ${lead.leadId} moved to Onboarding — welcome mail sent. Complete the OB→OBM checklist next.`,
        leadId,
      ).catch(() => {});
    }

    res.json({ checklist: updatedChecklist, stage: 'ONBOARDING' });
  } catch (err: any) {
    console.error('[pd-ob-checklist:send-welcome-mail]', err.message);
    res.status(500).json({ error: err.message });
  }
});
