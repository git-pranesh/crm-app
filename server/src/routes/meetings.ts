import { randomUUID } from 'crypto';
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';
import { sendEmail, noShowEmail, noShowNoPlanEmail, rescheduleEmail } from '../lib/email.js';
import { renderMailTemplate } from '../lib/mailTemplates.js';
import { createAndSendNps } from '../lib/npsHelper.js';
import { notifyManagers } from '../lib/notifications.js';
import { sendSms } from '../services/smsService.js';
import { recalculateMilestones } from '../lib/milestones.js';
import { queues } from '../jobs/index.js';
import { computeAutoRatingFromMode } from '../services/intentScoring.js';
import { isAuthorizedForLead } from '../lib/leadAuth.js';

export const meetingsRouter = Router({ mergeParams: true });
export const meetingStatusRouter = Router();

const meetingInclude = {
  lead: { select: { id: true, leadId: true, name: true, email: true } },
} as const;

// ── POST /api/leads/:leadId/meetings ─────────────────────────────────────────
meetingsRouter.post('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  const { type, mode, scheduledAt, location } = req.body as {
    type?: string;
    mode?: string;
    scheduledAt?: string;
    location?: string;
  };

  if (!type || !mode || !scheduledAt) {
    res.status(400).json({ error: 'type, mode, and scheduledAt are required' });
    return;
  }

  const validTypes = ['DQL', 'PP', 'ONBOARDING', 'DESIGN_FREEZE', 'SIGN_OFF'];
  const validModes = ['EC_VISIT', 'SITE_VISIT', 'VIRTUAL', 'PUBLIC_PLACE', 'CLIENT_PLACE'];

  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    return;
  }
  if (!validModes.includes(mode)) {
    res.status(400).json({ error: `mode must be one of: ${validModes.join(', ')}` });
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, leadId: true, name: true, email: true, phone: true, assignedDesignerId: true, assignedBLId: true, intentRating: true, intentRatingSource: true },
  });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  if (!(await isAuthorizedForLead(lead, user))) {
    res.status(403).json({ error: 'Not authorised to create meetings for this lead' });
    return;
  }

  // ── Duplicate-meeting guard ────────────────────────────────────────────────
  const activeMeeting = await prisma.meeting.findFirst({
    where: { leadId, status: 'SCHEDULED' },
    select: { id: true, type: true, scheduledAt: true },
  });
  if (activeMeeting) {
    const activeDate = new Date(activeMeeting.scheduledAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit',
    });
    res.status(409).json({
      error: `A ${activeMeeting.type} meeting is already scheduled for ${activeDate}. Reschedule or mark no-show before creating a new one.`,
    });
    return;
  }

  // Auto-number PP meetings — count only non-RESCHEDULED meetings so a
  // reschedule of PP1 doesn't cause the next genuine PP to become PP3.
  let ppNumber: number | null = null;
  if (type === 'PP') {
    const existingPP = await prisma.meeting.count({
      where: { leadId, type: 'PP', status: { not: 'RESCHEDULED' } },
    });
    ppNumber = existingPP + 1;
  }

  // Compute per-type sequence number — exclude RESCHEDULED so a rescheduled
  // DQL1 + its replacement both count as "DQL 1" in the active list.
  const seqCount = await prisma.meeting.count({
    where: { leadId, type: type as any, status: { not: 'RESCHEDULED' } },
  });
  const seqNumber = seqCount + 1;

  const meeting = await prisma.meeting.create({
    data: {
      leadId,
      type: type as any,
      ppNumber,
      mode: mode as any,
      scheduledAt: new Date(scheduledAt),
      location: location?.trim() || undefined,
      confirmationSent: true, // will be sent below
    },
    include: meetingInclude,
  });

  await logActivity(user.id, 'MEETING_SCHEDULED', leadId, {
    meetingId: meeting.id,
    type,
    ppNumber,
    seqNumber,
    scheduledAt,
  });

  // Notify the assigned BL/designer (whoever didn't book it) that a meeting was scheduled
  {
    const meetingLabel = ppNumber ? `PP${ppNumber}` : type;
    const dateStr = new Date(scheduledAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    });
    const notifyIds = new Set([lead.assignedBLId, lead.assignedDesignerId].filter(
      (id): id is string => !!id && id !== user.id,
    ));
    await Promise.all(
      [...notifyIds].map((id) =>
        createNotification(
          id,
          'MEETING_SCHEDULED',
          `${meetingLabel} meeting scheduled for ${lead.name} (${lead.leadId}) on ${dateStr}`,
          leadId,
        ),
      ),
    );
  }

  // Queue confirmation email (auto-trigger, no checkbox)
  if (lead.email) {
    const designer = await prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });
    const meetingDateStr = new Date(scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const rendered = await renderMailTemplate('MEETING_CONFIRMATION', {
      clientName: lead.name,
      type: ppNumber ? `PP${ppNumber}` : type,
      mode,
      scheduledAt: meetingDateStr,
      designerName: designer?.name ?? 'Your Designer',
    });
    const emailPayload = { to: lead.email, subject: rendered.subject, html: rendered.html };

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

  // ── Auto intent rating from meeting mode ──────────────────────────────────
  // Set immediately after a meeting is created so the funnel gate has an
  // up-to-date rating. Only applies when the current source is "auto" or not
  // yet set — a manual override from the designer is never auto-downgraded.
  //
  // Error semantics: failure here must NOT be silently swallowed, because a
  // missing IntentRatingLog creates an incomplete audit trail. We throw inside
  // the transaction so the caller receives a clear 500 if the audit write fails,
  // while the meeting record itself is already committed (atomic separation).
  {
    const currentLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { intentRatingSource: true, intentRating: true },
    });
    // Auto-set if: no rating yet, or last source was also auto
    if (!currentLead?.intentRatingSource || currentLead.intentRatingSource === 'auto') {
      const autoRating = computeAutoRatingFromMode(mode);
      // Both the Lead update AND the IntentRatingLog must succeed together.
      await prisma.$transaction([
        prisma.lead.update({
          where: { id: leadId },
          data: { intentRating: autoRating, intentRatingSource: 'auto' },
        }),
        prisma.intentRatingLog.create({
          data: {
            leadId,
            systemRating: autoRating,
            finalRating: autoRating,
            reason: `Auto-set from ${mode} meeting (meeting ID: ${meeting.id})`,
          },
        }),
      ]);
      await logActivity(user.id, 'INTENT_RATING_UPDATED', leadId, {
        rating: autoRating,
        systemRating: autoRating,
        reason: `Auto-set from ${mode} meeting mode`,
        isAuto: true,
      });
    }
  }

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

// ── GET /api/meetings — role-scoped global view ───────────────────────────────
meetingStatusRouter.get('/', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    let where: any = {};

    if (user.role === 'DESIGNER' || user.role === 'CRE') {
      where.lead = { assignedDesignerId: user.id };
    } else if (user.role === 'BL') {
      const members = await prisma.user.findMany({
        where: { blId: user.id },
        select: { id: true },
      });
      where.lead = { assignedDesignerId: { in: members.map((m: any) => m.id) } };
    }
    // BRANCH_HEAD: no filter = all meetings

    const meetings = await prisma.meeting.findMany({
      where,
      include: {
        lead: {
          select: {
            id: true, leadId: true, name: true, phone: true,
            assignedDesigner: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    res.json({ meetings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:leadId/meetings ──────────────────────────────────────────
meetingsRouter.get('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  // Lead-scope authorization
  const scopeLead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedDesignerId: true, assignedBLId: true },
  });
  if (!scopeLead) { res.status(404).json({ error: 'Lead not found' }); return; }
  if (!(await isAuthorizedForLead(scopeLead, user))) {
    res.status(403).json({ error: 'Not authorised to view meetings for this lead' });
    return;
  }

  const rawMeetings = await prisma.meeting.findMany({
    where: { leadId },
    include: meetingInclude,
    orderBy: { scheduledAt: 'desc' },
  });

  // Compute per-type sequence numbers (1-based, by creation order).
  // RESCHEDULED meetings are excluded from the counter so that a DQL which
  // was rescheduled once still appears as "DQL 1" (not "DQL 2") in the UI.
  // The RESCHEDULED record itself receives the same seqNumber as the active
  // replacement (they share the same conceptual meeting identity).
  const activeByType = new Map<string, number>();  // non-RESCHEDULED counter
  const seqById = new Map<string, number>();

  const sortedActive = [...rawMeetings]
    .filter((m) => m.status !== 'RESCHEDULED')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  sortedActive.forEach((m) => {
    const n = (activeByType.get(m.type) ?? 0) + 1;
    activeByType.set(m.type, n);
    seqById.set(m.id, n);
  });

  // For RESCHEDULED records: assign seqNumber based on creation order among all
  // meetings of that type (their original scheduled slot).
  const sortedAll = [...rawMeetings].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const allByType = new Map<string, number>();
  sortedAll.forEach((m) => {
    const n = (allByType.get(m.type) ?? 0) + 1;
    allByType.set(m.type, n);
    if (!seqById.has(m.id)) seqById.set(m.id, n); // only sets for RESCHEDULED records
  });

  const meetings = rawMeetings.map((m) => ({ ...m, seqNumber: seqById.get(m.id) ?? 1 }));

  res.json({ meetings });
});

// ── PATCH /api/meetings/:id/status ───────────────────────────────────────────
meetingStatusRouter.patch('/:id/status', verifyToken, async (req, res) => {
  const { id } = req.params;
  const user = req.user!;

  const { status, mom, rescheduledReason, noShowReason, outcome, newScheduledAt, replanScheduledAt, replanLocation } = req.body as {
    status?: string;
    mom?: string;
    rescheduledReason?: string;
    noShowReason?: string;
    outcome?: string;
    newScheduledAt?: string;
    replanScheduledAt?: string;
    replanLocation?: string;
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
  if (status === 'RESCHEDULED') {
    if (!newScheduledAt || isNaN(new Date(newScheduledAt).getTime())) {
      res.status(400).json({ error: 'newScheduledAt (new date & time) is required when rescheduling' });
      return;
    }
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (new Date(newScheduledAt).getTime() <= endOfToday.getTime()) {
      res.status(400).json({ error: 'The new meeting date must be after today — same-day or earlier reschedules are not allowed' });
      return;
    }
  }
  if (status === 'NO_SHOW') {
    if (!noShowReason?.trim()) {
      res.status(400).json({ error: 'noShowReason is required when marking NO_SHOW' });
      return;
    }
    if (!replanScheduledAt || isNaN(new Date(replanScheduledAt).getTime())) {
      res.status(400).json({ error: 'replanScheduledAt (next tentative date & time) is required when marking NO_SHOW' });
      return;
    }
    if (!replanLocation?.trim()) {
      res.status(400).json({ error: 'replanLocation is required when marking NO_SHOW' });
      return;
    }
  }

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { lead: true },
  });
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }

  // Lead-scope authorization
  if (!(await isAuthorizedForLead(meeting.lead, user))) {
    res.status(403).json({ error: 'Not authorised to update this meeting' });
    return;
  }

  // Enforce valid source status — only SCHEDULED meetings can be transitioned
  if (meeting.status !== 'SCHEDULED') {
    res.status(400).json({ error: `Cannot change status of a meeting that is already ${meeting.status}` });
    return;
  }

  const lead = meeting.lead;

  // ── RESCHEDULED: atomic archive + replacement creation ───────────────────────
  let updated: any;
  let replacementMeeting: any = null;

  if (status === 'RESCHEDULED') {
    const previousHistory = (meeting.rescheduleHistory as any[]) ?? [];
    const archiveData = {
      status: 'RESCHEDULED' as const,
      outcome,
      rescheduledReason,
      rescheduleHistory: [
        ...previousHistory,
        {
          scheduledAt: meeting.scheduledAt.toISOString(),
          reason: rescheduledReason,
          rescheduledAt: new Date().toISOString(),
        },
      ],
    };

    const txResult = await prisma.$transaction(async (tx) => {
      const archived = await tx.meeting.update({
        where: { id },
        data: archiveData,
        include: meetingInclude,
      });
      const replacement = await tx.meeting.create({
        data: {
          leadId: lead.id,
          type: meeting.type as any,
          mode: meeting.mode as any,
          location: meeting.location,
          ppNumber: meeting.ppNumber,
          scheduledAt: new Date(newScheduledAt!),
          confirmationSent: true,
        },
        include: meetingInclude,
      });
      await tx.activityLog.create({
        data: {
          userId: user.id,
          action: 'MEETING_RESCHEDULED',
          leadId: lead.id,
          meta: {
            originalMeetingId: id,
            replacementMeetingId: replacement.id,
            rescheduledReason,
            oldDate: meeting.scheduledAt.toISOString(),
            newDate: new Date(newScheduledAt!).toISOString(),
          },
        },
      });
      return { archived, replacement };
    });

    updated = txResult.archived;
    replacementMeeting = txResult.replacement;
  } else {
    // ── COMPLETED / NO_SHOW ──────────────────────────────────────────────────
    const updateData: any = { status, outcome };
    if (status === 'COMPLETED') {
      updateData.mom = mom;
      updateData.momSent = true;
    }
    if (status === 'NO_SHOW') {
      updateData.noShowReason = noShowReason!.trim();
      updateData.replanScheduledAt = new Date(replanScheduledAt!);
      updateData.replanLocation = replanLocation!.trim();
    }
    updated = await prisma.meeting.update({
      where: { id },
      data: updateData,
      include: meetingInclude,
    });
  }

  // Auto-triggered emails
  if (lead.email) {
    let emailPayload;

    if (status === 'COMPLETED') {
      const rendered = await renderMailTemplate('MOM', {
        clientName: lead.name,
        meetingType: meeting.ppNumber ? `PP${meeting.ppNumber}` : meeting.type,
        scheduledAt: meeting.scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        mom: mom!.replace(/\n/g, '<br/>'),
      });
      emailPayload = { to: '', subject: rendered.subject, html: rendered.html };
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
      const newTime = new Date(newScheduledAt!).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      });
      sendSms(
        lead.phone,
        `Hi ${lead.name}, your meeting has been rescheduled to ${newTime}. Reason: ${rescheduledReason}. - Interiors by DeX`,
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

  // In-app notification + email for NO_SHOW — enhanced when no follow-up meeting is planned
  if (status === 'NO_SHOW') {
    const plannedMeeting = await prisma.meeting.findFirst({
      where: { leadId: lead.id, status: 'SCHEDULED' },
      select: { id: true },
    });
    // A captured replan date/time/location on this record counts as a plan too.
    const hasNoPlan = !plannedMeeting && !replanScheduledAt;
    const noShowMsg = hasNoPlan
      ? `⚠ Client ${lead.name} (${lead.leadId}) was a no-show for the ${meeting.type} meeting and has NO follow-up meeting scheduled. Immediate action required.`
      : `Client ${lead.name} (${lead.leadId}) was a no-show for the ${meeting.type} meeting.`;

    // In-app notifications
    if (lead.assignedBLId) {
      await createNotification(lead.assignedBLId, 'MEETING_NO_SHOW', noShowMsg, lead.id);
    }
    await notifyManagers('MEETING_NO_SHOW', noShowMsg, lead.id);

    // Send email to BL + managers when no follow-up plan exists
    if (hasNoPlan) {
      const recipients: { name: string; email: string }[] = [];
      if (lead.assignedBLId) {
        const bl = await prisma.user.findUnique({ where: { id: lead.assignedBLId }, select: { name: true, email: true } });
        if (bl?.email) recipients.push(bl);
      }
      const managers = await prisma.user.findMany({
        where: { role: { in: ['BRANCH_HEAD'] }, isActive: true },
        select: { name: true, email: true },
      });
      for (const mgr of managers) { if (mgr.email) recipients.push(mgr); }

      for (const recipient of recipients) {
        const emailPayload = noShowNoPlanEmail({
          recipientName: recipient.name,
          leadId: lead.leadId,
          leadName: lead.name,
          meetingType: meeting.type,
          noShowReason: noShowReason!,
        });
        emailPayload.to = recipient.email!;
        queues.emails.add('no-show-no-plan', { emailPayload, leadId: lead.id }).catch(() => {});
      }
    }
  }

  // Log activity — RESCHEDULED already logged inside the reschedule block above
  if (status !== 'RESCHEDULED') {
    await logActivity(user.id, `MEETING_${status}`, lead.id, {
      meetingId: id,
      mom,
    });
  }

  await recalculateMilestones(lead.id);

  // NPS email triggers on meeting completion
  if (status === 'COMPLETED') {
    if (meeting.type === 'DQL' || meeting.type === 'PP') {
      // Sales NPS — triggered when first real sales meeting completes
      createAndSendNps(lead.id, 'SALE').catch(() => {});
    }
    if (meeting.type === 'DESIGN_FREEZE') {
      createAndSendNps(lead.id, 'DESIGN_FREEZE').catch(() => {});
    }
    if (meeting.type === 'SIGN_OFF') {
      createAndSendNps(lead.id, 'SIGN_OFF').catch(() => {});
    }
  }

  res.json({ meeting: updated, replacementMeeting: replacementMeeting ?? undefined });
});
