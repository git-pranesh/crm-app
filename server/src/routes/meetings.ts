import { randomUUID } from 'crypto';
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';
import { sendEmail, meetingConfirmationEmail, momEmail, noShowEmail, rescheduleEmail } from '../lib/email.js';
import { sendSms } from '../services/smsService.js';
import { recalculateMilestones } from '../lib/milestones.js';
import { queues } from '../jobs/index.js';

export const meetingsRouter = Router({ mergeParams: true });
export const meetingStatusRouter = Router();

const meetingInclude = {
  lead: { select: { id: true, leadId: true, name: true, email: true } },
} as const;

// ── POST /api/leads/:leadId/meetings ─────────────────────────────────────────
meetingsRouter.post('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  const { type, mode, scheduledAt } = req.body as {
    type?: string;
    mode?: string;
    scheduledAt?: string;
  };

  if (!type || !mode || !scheduledAt) {
    res.status(400).json({ error: 'type, mode, and scheduledAt are required' });
    return;
  }

  const validTypes = ['DQL', 'PP'];
  const validModes = ['EC_VISIT', 'SITE_VISIT', 'VIRTUAL', 'PUBLIC_PLACE'];

  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `type must be DQL or PP` });
    return;
  }
  if (!validModes.includes(mode)) {
    res.status(400).json({ error: `mode must be one of: ${validModes.join(', ')}` });
    return;
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  // Auto-number PP meetings
  let ppNumber: number | null = null;
  if (type === 'PP') {
    const existingPP = await prisma.meeting.count({
      where: { leadId, type: 'PP' },
    });
    ppNumber = existingPP + 1;
  }

  const meeting = await prisma.meeting.create({
    data: {
      leadId,
      type: type as any,
      ppNumber,
      mode: mode as any,
      scheduledAt: new Date(scheduledAt),
      confirmationSent: true, // will be sent below
    },
    include: meetingInclude,
  });

  await logActivity(user.id, 'MEETING_SCHEDULED', leadId, {
    meetingId: meeting.id,
    type,
    ppNumber,
    scheduledAt,
  });

  // Queue confirmation email (auto-trigger, no checkbox)
  if (lead.email) {
    const designer = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });
    const emailPayload = meetingConfirmationEmail({
      clientName: lead.name,
      type: ppNumber ? `PP${ppNumber}` : type,
      mode,
      scheduledAt: new Date(scheduledAt),
      designerName: designer?.name ?? 'Your Designer',
    });
    emailPayload.to = lead.email;

    queues.emails.add('meeting-confirmation', { emailPayload, leadId, meetingId: meeting.id }).catch(() => {});

    await prisma.emailLog.create({
      data: {
        leadId,
        type: 'MEETING_CONFIRMATION',
        sentTo: lead.email,
        subject: emailPayload.subject,
      },
    });
  }

  await recalculateMilestones(leadId);

  // SMS: meeting confirmation (auto-trigger)
  if (lead.phone) {
    const meetingLabel = ppNumber ? `PP${ppNumber}` : type;
    const dateStr = new Date(scheduledAt).toLocaleString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
    sendSms(
      lead.phone,
      `Hi ${lead.name}, your ${meetingLabel} meeting is confirmed for ${dateStr}. - Interiors by DeX`,
      leadId,
    ).catch((e) => console.warn('[meetings:sms:scheduled]', e.message));
  }

  res.status(201).json({ meeting });
});

// ── GET /api/leads/:leadId/meetings ──────────────────────────────────────────
meetingsRouter.get('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };

  const meetings = await prisma.meeting.findMany({
    where: { leadId },
    include: meetingInclude,
    orderBy: { scheduledAt: 'desc' },
  });

  res.json({ meetings });
});

// ── PATCH /api/meetings/:id/status ───────────────────────────────────────────
meetingStatusRouter.patch('/:id/status', verifyToken, async (req, res) => {
  const { id } = req.params;
  const user = req.user!;

  const { status, mom, rescheduledReason, outcome } = req.body as {
    status?: string;
    mom?: string;
    rescheduledReason?: string;
    outcome?: string;
  };

  const validStatuses = ['COMPLETED', 'RESCHEDULED', 'NO_SHOW'];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    return;
  }

  if (status === 'COMPLETED' && !mom?.trim()) {
    res.status(400).json({ error: 'mom (Minutes of Meeting) is required when marking COMPLETED' });
    return;
  }
  if (status === 'RESCHEDULED' && !rescheduledReason?.trim()) {
    res.status(400).json({ error: 'rescheduledReason is required when marking RESCHEDULED' });
    return;
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { lead: true },
  });
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }

  const updateData: any = { status, outcome };
  if (status === 'COMPLETED') {
    updateData.mom = mom;
    updateData.momSent = true;
  }
  if (status === 'RESCHEDULED') {
    updateData.rescheduledReason = rescheduledReason;
  }

  const updated = await prisma.meeting.update({
    where: { id },
    data: updateData,
    include: meetingInclude,
  });

  const lead = meeting.lead;

  // Auto-triggered emails
  if (lead.email) {
    let emailPayload;

    if (status === 'COMPLETED') {
      emailPayload = momEmail({
        clientName: lead.name,
        meetingType: meeting.ppNumber ? `PP${meeting.ppNumber}` : meeting.type,
        scheduledAt: meeting.scheduledAt,
        mom: mom!,
      });
    } else if (status === 'RESCHEDULED') {
      emailPayload = rescheduleEmail({
        clientName: lead.name,
        reason: rescheduledReason!,
      });
    } else if (status === 'NO_SHOW') {
      emailPayload = noShowEmail({ clientName: lead.name });
    }

    if (emailPayload) {
      emailPayload.to = lead.email;
      queues.emails.add(`meeting-${status.toLowerCase()}`, {
        emailPayload,
        leadId: lead.id,
        meetingId: id,
      }).catch(() => {});

      await prisma.emailLog.create({
        data: {
          leadId: lead.id,
          type: `MEETING_${status}`,
          sentTo: lead.email,
          subject: emailPayload.subject,
        },
      });
    }
  }

  // SMS: status-triggered messages
  if (lead.phone) {
    if (status === 'COMPLETED') {
      sendSms(
        lead.phone,
        `Hi ${lead.name}, your meeting summary (MOM) has been emailed to you. - Interiors by DeX`,
        lead.id,
      ).catch((e) => console.warn('[meetings:sms:mom]', e.message));
    } else if (status === 'RESCHEDULED') {
      sendSms(
        lead.phone,
        `Hi ${lead.name}, your meeting has been rescheduled. Reason: ${rescheduledReason}. We'll share the new time shortly. - Interiors by DeX`,
        lead.id,
      ).catch((e) => console.warn('[meetings:sms:rescheduled]', e.message));
    } else if (status === 'NO_SHOW') {
      sendSms(
        lead.phone,
        `Hi ${lead.name}, we missed you at today's meeting. Please reply with your available times and we'll reschedule. - Interiors by DeX`,
        lead.id,
      ).catch((e) => console.warn('[meetings:sms:no_show]', e.message));
    }
  }

  // In-app notification for NO_SHOW
  if (status === 'NO_SHOW' && lead.assignedBLId) {
    await createNotification(
      lead.assignedBLId,
      'MEETING_NO_SHOW',
      `Client ${lead.name} (${lead.leadId}) was a no-show for the ${meeting.type} meeting.`,
      lead.id,
    );
  }

  await logActivity(user.id, `MEETING_${status}`, lead.id, {
    meetingId: id,
    mom,
    rescheduledReason,
  });

  await recalculateMilestones(lead.id);

  // Auto-create NPS request when DQL or PP meeting is COMPLETED (G2)
  if (status === 'COMPLETED' && (meeting.type === 'DQL' || meeting.type === 'PP')) {
    try {
      const formToken = randomUUID();
      await prisma.nPSResponse.create({
        data: {
          leadId: lead.id,
          stage: 'SALE',
          formToken,
        },
      });
    } catch (e) {
      console.warn('[meetings:nps:create]', (e as Error).message);
    }
  }

  res.json({ meeting: updated });
});
