import multer from 'multer';
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { createNotification, notifyManagers } from '../lib/notifications.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { isAuthorizedForLead, isAuthorizedToAssignTask } from '../lib/leadAuth.js';
import { renderMailTemplate } from '../lib/mailTemplates.js';
import { sendEmail } from '../lib/email.js';
import { assertNextPlanMeetingSchedulable, createNextPlanRecords, runNextPlanMeetingSideEffects, sendNextPlanMails, summarizeNextPlanItems, validateFutureDate, validateMeetingTypeMode, validateNextPlanItems, type NextPlanItem } from '../lib/nextPlanOfAction.js';
import { assertNoActiveMeeting, computeMeetingNumbering, createMeetingRecord, runMeetingScheduledSideEffects } from '../lib/meetingScheduler.js';
import { validateAttachmentPairing, validateGenericAttachments } from '../lib/attachmentValidation.js';
import { isLeadLocked, sendLeadLockedError } from '../lib/leadLock.js';

export const callsRouter = Router({ mergeParams: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const CALL_ATTACHMENT_TYPES = ['Lifestyle Capture', 'Proposal', 'Pitch Presentation'] as const;

const RNR_OUTCOMES = ['RNR_1', 'RNR_2', 'RNR_3', 'RNR_4', 'RNR_5', 'RNR_6_PLUS'] as const;
const ESCALATION_THRESHOLD = 5;
const INACTIVATION_MONTHS = 3;

const VALID_OUTCOMES = ['ANSWERED', 'RNR_1', 'RNR_2', 'RNR_3', 'RNR_4', 'RNR_5', 'RNR_6_PLUS', 'CALLBACK', 'MEETING_SCHEDULED'];

// Same stage vocabulary as MeetingType, since a scheduled call is typically
// "the DQL call", "the PP call", etc. — kept as a plain string on FollowUpTask
// rather than the MeetingType enum since this is a call, not a meeting.
const CALL_STAGE_TYPES = ['DQL', 'PP', 'PD', 'ONBOARDING', 'OBM', 'OTHER'];
const CALL_TASK_TYPES = ['INTERNAL', 'EXTERNAL'];

// ── POST /api/leads/:leadId/calls ─────────────────────────────────────────────
callsRouter.post('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  const {
    outcome,
    duration,
    notes,
    recordingUrl,
    location,
    calledAt,
    attachments,
    followUpTask,
    callbackDetails,
    meetingDetails,
    nextPlanOfAction,
  } = req.body as {
    outcome: string;
    duration?: number;
    notes?: string;
    recordingUrl?: string;
    location?: string;
    calledAt?: string;
    attachments?: { type: string; fileUrl?: string; storagePath?: string }[];
    followUpTask?: { dueDate: string; dueTime?: string; assignedToId?: string; attachments?: { type: string; fileUrl?: string; storagePath?: string }[] };
    // Required when outcome === 'CALLBACK': asks for date/time + agenda
    callbackDetails?: { dueDate: string; dueTime?: string; agenda?: string; assignedToId?: string; attachments?: { type: string; fileUrl?: string; storagePath?: string }[] };
    // Required when outcome === 'MEETING_SCHEDULED': creates a linked Meeting instead of a follow-up task
    meetingDetails?: { type: string; mode: string; scheduledAt: string; location?: string };
    // Shared Call/Meeting/Task multi-select "next plan of action" flow
    nextPlanOfAction?: NextPlanItem[];
  };

  if (!outcome) {
    res.status(400).json({ error: 'outcome is required' });
    return;
  }

  if (!VALID_OUTCOMES.includes(outcome)) {
    res.status(400).json({ error: `outcome must be one of: ${VALID_OUTCOMES.join(', ')}` });
    return;
  }

  // Call notes are mandatory
  if (!notes?.trim()) {
    res.status(400).json({ error: 'Call notes are required' });
    return;
  }

  if (outcome === 'CALLBACK') {
    try {
      validateGenericAttachments(callbackDetails?.attachments, 'callbackDetails.attachments');
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!callbackDetails?.dueTime) {
      res.status(400).json({ error: 'callbackDetails.dueDate and dueTime are required when outcome is CALLBACK' });
      return;
    }
    try {
      validateFutureDate(callbackDetails?.dueDate, 'callbackDetails.dueDate');
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  } else if (outcome === 'MEETING_SCHEDULED') {
    try {
      validateMeetingTypeMode(meetingDetails?.type, meetingDetails?.mode, meetingDetails?.scheduledAt, 'meetingDetails', meetingDetails?.location);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  } else {
    // Enforce mandatory follow-up with both date and time for every other outcome
    try {
      validateGenericAttachments(followUpTask?.attachments, 'followUpTask.attachments');
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (!followUpTask?.dueTime) {
      res.status(400).json({
        error: 'A follow-up task with due date and time must be set before saving the call',
      });
      return;
    }
    try {
      validateFutureDate(followUpTask?.dueDate, 'followUpTask.dueDate');
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  }

  if (attachments?.length) {
    try {
      validateAttachmentPairing(attachments, CALL_ATTACHMENT_TYPES, 'attachments');
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
  }

  if (nextPlanOfAction?.length) {
    try {
      validateNextPlanItems(nextPlanOfAction);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
      return;
    }
    // The call outcome itself may already schedule a meeting (MEETING_SCHEDULED);
    // combining that with a next-plan MEETING item would try to create two
    // meetings for the same lead in one request, defeating the single-active-
    // meeting guard (which only sees committed state, not this in-flight batch).
    if (outcome === 'MEETING_SCHEDULED' && nextPlanOfAction.some((item) => item.kind === 'MEETING')) {
      res.status(400).json({ error: 'Cannot include a next-plan MEETING item when the call outcome itself is MEETING_SCHEDULED' });
      return;
    }
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, leadId: true, name: true, phone: true, email: true, createdAt: true, assignedDesignerId: true, assignedBLId: true, status: true },
  });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  if (!(await isAuthorizedForLead(lead, user))) {
    res.status(403).json({ error: 'Not authorised to log calls for this lead' });
    return;
  }
  if (isLeadLocked(lead.status)) { sendLeadLockedError(res); return; }

  // callbackDetails/followUpTask may target another user's queue — the same
  // reporting-scope rule task creation uses applies here so a caller can't
  // use a call log as a side channel to assign a follow-up to an arbitrary user.
  for (const target of [callbackDetails?.assignedToId, followUpTask?.assignedToId]) {
    if (target && !(await isAuthorizedToAssignTask(target, user))) {
      res.status(403).json({ error: 'Not authorised to assign a follow-up to this user' });
      return;
    }
  }

  // A call that schedules a meeting must obey the same one-active-meeting-per-lead
  // invariant as the standalone meeting scheduler, and needs the same PP/sequence
  // numbering — computed up-front so it can be used inside the transaction below.
  let meetingPpNumber: number | null = null;
  if (outcome === 'MEETING_SCHEDULED') {
    try {
      await assertNoActiveMeeting(leadId);
    } catch (err: any) {
      res.status(409).json({ error: err.message });
      return;
    }
    ({ ppNumber: meetingPpNumber } = await computeMeetingNumbering(leadId, meetingDetails!.type));
  }

  // Same guard/numbering for a next-plan-of-action MEETING item (mutually
  // exclusive with the above per the check earlier in this handler).
  let nextPlanMeetingPpNumber: number | null = null;
  if (nextPlanOfAction?.length) {
    try {
      nextPlanMeetingPpNumber = await assertNextPlanMeetingSchedulable(nextPlanOfAction, leadId);
    } catch (err: any) {
      res.status(409).json({ error: err.message });
      return;
    }
  }

  // Create call + follow-up task / linked meeting in a transaction
  const { call, task, meeting, nextPlanMeeting } = await prisma.$transaction(async (tx) => {
    const newCall = await tx.call.create({
      data: {
        leadId,
        loggedById: user.id,
        outcome: outcome as any,
        duration,
        notes,
        recordingUrl,
        location: location?.trim() || undefined,
        calledAt: calledAt ? new Date(calledAt) : undefined,
        attachments: attachments ?? undefined,
        nextPlanOfAction: nextPlanOfAction?.length ? summarizeNextPlanItems(nextPlanOfAction) : undefined,
        nextPlanOfActionItems: nextPlanOfAction?.length ? (nextPlanOfAction as any) : undefined,
      },
    });

    let newTask: Awaited<ReturnType<typeof tx.followUpTask.create>> | null = null;
    let newMeeting: Awaited<ReturnType<typeof tx.meeting.create>> | null = null;

    // Timestamp used for the CALL_LOGGED activity row so it lines up with
    // whatever follow-up record was created (kept for historical consistency
    // with other activity timestamps on the lead).
    let logAt = new Date();

    if (outcome === 'CALLBACK') {
      newTask = await tx.followUpTask.create({
        data: {
          leadId,
          assignedToId: callbackDetails!.assignedToId ?? user.id,
          dueDate: new Date(callbackDetails!.dueDate),
          dueTime: callbackDetails!.dueTime,
          timeFrom: callbackDetails!.dueTime,
          agenda: callbackDetails!.agenda?.trim() || undefined,
          originatingCallId: newCall.id,
          attachments: callbackDetails!.attachments?.length ? (callbackDetails!.attachments as any) : undefined,
        },
      });
      logAt = newTask.createdAt;
    } else if (outcome === 'MEETING_SCHEDULED') {
      newMeeting = await createMeetingRecord(tx, {
        leadId,
        type: meetingDetails!.type,
        mode: meetingDetails!.mode,
        scheduledAt: meetingDetails!.scheduledAt,
        location: meetingDetails!.location,
        ppNumber: meetingPpNumber,
        originatingCallId: newCall.id,
      });
      logAt = newMeeting.createdAt;
    } else {
      newTask = await tx.followUpTask.create({
        data: {
          leadId,
          assignedToId: followUpTask!.assignedToId ?? user.id,
          dueDate: new Date(followUpTask!.dueDate),
          dueTime: followUpTask!.dueTime,
          timeFrom: followUpTask!.dueTime,
          originatingCallId: newCall.id,
          attachments: followUpTask!.attachments?.length ? (followUpTask!.attachments as any) : undefined,
        },
      });
      logAt = newTask.createdAt;
    }

    await tx.activityLog.create({
      data: {
        userId: user.id,
        action: 'CALL_LOGGED',
        leadId,
        meta: { outcome, duration },
        createdAt: logAt,
      },
    });

    // Shared "next plan of action" multi-select — creates any extra linked
    // Call/Meeting/Task records beyond the mandatory follow-up above, in the
    // SAME transaction as the call itself so a mid-batch failure rolls the
    // whole call log back instead of reporting success on a partial plan.
    let nextPlanMeeting: Awaited<ReturnType<typeof createNextPlanRecords>>['meetingCreated'] = null;
    if (nextPlanOfAction?.length) {
      ({ meetingCreated: nextPlanMeeting } = await createNextPlanRecords(tx, nextPlanOfAction, {
        leadId, userId: user.id, originatingCallId: newCall.id, meetingPpNumber: nextPlanMeetingPpNumber,
      }));
    }

    return { call: newCall, task: newTask, meeting: newMeeting, nextPlanMeeting };
  });

  // Best-effort per-item client mail — only fired once the transaction above
  // has committed, so a mail failure never rolls back a persisted plan.
  if (nextPlanOfAction?.length) {
    await sendNextPlanMails(nextPlanOfAction, { name: lead.name, email: lead.email });
  }

  // A next-plan-created meeting needs the same side effects as any other
  // scheduled meeting — fired only after the transaction above has committed.
  if (nextPlanMeeting) {
    await runNextPlanMeetingSideEffects(
      nextPlanMeeting,
      { id: lead.id, leadId: lead.leadId, name: lead.name, email: lead.email, phone: lead.phone, assignedDesignerId: lead.assignedDesignerId, assignedBLId: lead.assignedBLId },
      user,
    );
  }

  // A call-created meeting must go through the same side effects (activity
  // log, stakeholder notifications, client confirmation email/SMS, milestone
  // recalculation, auto intent-rating) as the standalone meeting scheduler —
  // fired only after the transaction above has committed the meeting row.
  if (outcome === 'MEETING_SCHEDULED' && meeting) {
    await runMeetingScheduledSideEffects({
      meeting,
      lead: { id: lead.id, leadId: lead.leadId, name: lead.name, email: lead.email, phone: lead.phone, assignedDesignerId: lead.assignedDesignerId, assignedBLId: lead.assignedBLId },
      user,
      type: meetingDetails!.type,
      mode: meetingDetails!.mode,
      scheduledAt: meetingDetails!.scheduledAt,
      ppNumber: meetingPpNumber,
    });
  }

  // Notify the assigned BL (if not the one who logged the call) that a call happened
  if (lead.assignedBLId && lead.assignedBLId !== user.id) {
    await createNotification(
      lead.assignedBLId,
      'CALL_LOGGED',
      `Call logged for ${lead.name} (${lead.leadId}) — outcome: ${outcome.replace(/_/g, ' ')}`,
      leadId,
    );
  }

  // Notify the follow-up task's assignee (if not the one who logged the call)
  if (task && task.assignedToId !== user.id) {
    const dueStr = new Date(task.dueDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
    await createNotification(
      task.assignedToId,
      'TASK_SCHEDULED',
      `Follow-up task scheduled for ${lead.name} (${lead.leadId}) — due ${dueStr}${task.dueTime ? ` at ${task.dueTime}` : ''}`,
      leadId,
      new Date(task.dueDate),
    );
  }

  // Once a call is logged as successfully answered, auto-mail the client with
  // the notes + follow-up plan, CC'ing the designer, BL, and management.
  if (outcome === 'ANSWERED' && lead.email) {
    const followUpDate = task
      ? new Date(task.dueDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) + (task.dueTime ? ` at ${task.dueTime}` : '')
      : meeting
        ? new Date(meeting.scheduledAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })
        : 'To be confirmed';

    const ccIds = [lead.assignedDesignerId, lead.assignedBLId].filter((v): v is string => !!v);
    const ccUsers = ccIds.length
      ? await prisma.user.findMany({ where: { id: { in: ccIds } }, select: { email: true } })
      : [];
    const managers = await prisma.user.findMany({ where: { role: 'BRANCH_HEAD' }, select: { email: true } });
    const cc = [...ccUsers, ...managers].map((u) => u.email).filter((e): e is string => !!e);

    const { subject, html } = await renderMailTemplate('CALL_LOG_SUMMARY', {
      clientName: lead.name,
      notes: notes.trim(),
      followUpDate,
    });
    await sendEmail({ to: lead.email, cc, subject, html }).catch(() => {});
  }

  // RNR escalation logic
  const rnrCount = await prisma.call.count({
    where: { leadId, outcome: { in: [...RNR_OUTCOMES] } },
  });

  let needsEscalation = false;
  let needsInactivationPrompt = false;

  if (rnrCount >= ESCALATION_THRESHOLD) {
    needsEscalation = true;

    // Check if 3 months have passed since lead creation
    const monthsOld =
      (Date.now() - lead.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30);

    if (monthsOld >= INACTIVATION_MONTHS) {
      needsInactivationPrompt = true;
    } else {
      // Notify BL about escalation need
      await notifyManagers(
        'RNR_ESCALATION',
        `Lead ${lead.leadId} (${lead.name}) has ${rnrCount} RNR attempts. Escalation review needed.`,
        leadId,
      );
    }
  }

  res.status(201).json({
    call,
    followUpTask: task,
    meeting,
    needsEscalation,
    needsInactivationPrompt,
    openCallLogTab: true,
  });
});

// ── POST /api/leads/:leadId/calls/schedule ────────────────────────────────────
// Distinct entry point for scheduling a call that hasn't happened yet — separate
// from POST '/' above (Log Call), which always records a call that already took
// place. Creates a FollowUpTask marked with callStageType so it renders as a
// "Scheduled Call" wherever calls/tasks are shown, and can later be completed
// (logged) or rescheduled through the existing follow-up task flow.
callsRouter.post('/schedule', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  const { stageType, agenda, taskType, dueDate, dueTime, assignedToId } = req.body as {
    stageType: string;
    agenda?: string;
    taskType: string;
    dueDate: string;
    dueTime: string;
    assignedToId?: string;
  };

  if (!stageType || !CALL_STAGE_TYPES.includes(stageType)) {
    res.status(400).json({ error: `stageType must be one of: ${CALL_STAGE_TYPES.join(', ')}` });
    return;
  }
  if (!taskType || !CALL_TASK_TYPES.includes(taskType)) {
    res.status(400).json({ error: `taskType must be one of: ${CALL_TASK_TYPES.join(', ')}` });
    return;
  }
  if (!dueDate || !dueTime) {
    res.status(400).json({ error: 'dueDate and dueTime are required to schedule a call' });
    return;
  }
  try {
    validateFutureDate(dueDate, 'dueDate');
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, leadId: true, name: true, assignedDesignerId: true, assignedBLId: true, status: true },
  });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  if (!(await isAuthorizedForLead(lead, user))) {
    res.status(403).json({ error: 'Not authorised to schedule calls for this lead' });
    return;
  }
  if (isLeadLocked(lead.status)) { sendLeadLockedError(res); return; }

  if (assignedToId && !(await isAuthorizedToAssignTask(assignedToId, user))) {
    res.status(403).json({ error: 'Not authorised to assign a scheduled call to this user' });
    return;
  }

  const task = await prisma.followUpTask.create({
    data: {
      leadId,
      assignedToId: assignedToId ?? user.id,
      dueDate: new Date(dueDate),
      dueTime,
      timeFrom: dueTime,
      agenda: agenda?.trim() || undefined,
      taskType: taskType as any,
      callStageType: stageType,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: 'CALL_SCHEDULED',
      leadId,
      meta: { stageType, taskType, dueDate, dueTime },
    },
  });

  if (task.assignedToId !== user.id) {
    const dueStr = new Date(task.dueDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
    await createNotification(
      task.assignedToId,
      'TASK_SCHEDULED',
      `Call scheduled for ${lead.name} (${lead.leadId}) — ${stageType} call due ${dueStr} at ${dueTime}`,
      leadId,
      new Date(task.dueDate),
    );
  }

  res.status(201).json({ scheduledCall: task });
});

// ── Allowed MIME types for call attachments ───────────────────────────────────
const ALLOWED_ATTACHMENT_MIMES = new Set([
  'application/pdf',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ALLOWED_ATTACHMENT_EXTS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'ppt', 'pptx', 'doc', 'docx']);
const CALL_ATTACHMENTS_BUCKET = 'crm-call-attachments'; // private bucket

// ── GET /api/leads/:leadId/calls ──────────────────────────────────────────────
callsRouter.get('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  // Enforce lead-scope authorization before exposing signed attachment URLs
  const scopeLead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedDesignerId: true, assignedBLId: true },
  });
  if (!scopeLead) { res.status(404).json({ error: 'Lead not found' }); return; }
  if (!(await isAuthorizedForLead(scopeLead, user))) {
    res.status(403).json({ error: 'Not authorised to view calls for this lead' });
    return;
  }

  const rawCalls = await prisma.call.findMany({
    where: { leadId },
    include: { loggedBy: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // Generate fresh signed URLs for any call attachments stored as storagePaths
  const calls = await Promise.all(
    rawCalls.map(async (call) => {
      const attachments = call.attachments as { type: string; storagePath?: string; fileUrl?: string }[] | null;
      if (!attachments?.length || !supabaseAdmin) return call;
      const hydratedAttachments = await Promise.all(
        attachments.map(async (att) => {
          if (!att.storagePath) return att; // legacy public URL — return as-is
          const { data, error } = await supabaseAdmin!.storage
            .from(CALL_ATTACHMENTS_BUCKET)
            .createSignedUrl(att.storagePath, 60 * 60); // 1-hour signed URL
          return { type: att.type, fileUrl: error ? undefined : data?.signedUrl };
        }),
      );
      return { ...call, attachments: hydratedAttachments };
    }),
  );

  const rnrCount = rawCalls.filter((c) => RNR_OUTCOMES.includes(c.outcome as any)).length;

  // Scheduled-but-not-yet-made calls (created via "Schedule Call") — surfaced
  // in the same response so the Call tab can render them alongside logged
  // calls, clearly distinguished, without a second round-trip.
  const scheduledCalls = await prisma.followUpTask.findMany({
    where: { leadId, callStageType: { not: null }, status: 'PENDING' },
    include: { assignedTo: { select: { id: true, name: true, role: true } } },
    orderBy: { dueDate: 'asc' },
  });

  res.json({ calls, rnrCount, needsEscalation: rnrCount >= ESCALATION_THRESHOLD, scheduledCalls });
});

// ── POST /api/leads/:leadId/calls/upload-attachment ───────────────────────────
callsRouter.post(
  '/upload-attachment',
  verifyToken,
  upload.single('file') as any,
  async (req, res) => {
    try {
      const { leadId } = req.params as { leadId: string };

      // Verify the lead exists and the requester is authorised for it
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, assignedDesignerId: true, assignedBLId: true, status: true },
      });
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      if (!(await isAuthorizedForLead(lead, req.user!))) {
        res.status(403).json({ error: 'Not authorised to upload files for this lead' });
        return;
      }
      if (isLeadLocked(lead.status)) { sendLeadLockedError(res); return; }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // Validate MIME type and extension
      const ext = (file.originalname.split('.').pop() ?? '').toLowerCase();
      if (!ALLOWED_ATTACHMENT_MIMES.has(file.mimetype) || !ALLOWED_ATTACHMENT_EXTS.has(ext)) {
        res.status(400).json({
          error: `Unsupported file type. Allowed types: PDF, images (JPG, PNG, WebP), Word, and PowerPoint.`,
        });
        return;
      }

      if (!supabaseAdmin) {
        res.status(500).json({ error: 'Supabase storage not configured' });
        return;
      }

      // Use private bucket — never public
      await supabaseAdmin.storage.createBucket(CALL_ATTACHMENTS_BUCKET, { public: false }).catch(() => {});

      const storagePath = `${leadId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(CALL_ATTACHMENTS_BUCKET)
        .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
      if (uploadError) {
        res.status(500).json({ error: uploadError.message });
        return;
      }

      // Return a short-lived signed URL for immediate display, plus the storagePath for DB storage
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(CALL_ATTACHMENTS_BUCKET)
        .createSignedUrl(storagePath, 60 * 60); // 1 hour
      if (signError) {
        res.status(500).json({ error: signError.message });
        return;
      }

      // Client stores storagePath in DB; signedUrl is for immediate display only
      res.json({ storagePath, signedUrl: signed?.signedUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ── Standalone router — GET /api/calls/:id/recording-url ─────────────────────
export const callsStandaloneRouter = Router();

callsStandaloneRouter.get('/:id/recording-url', verifyToken, async (req, res) => {
  try {
    const call = await prisma.call.findUnique({
      where: { id: req.params.id },
      select: { id: true, recordingUrl: true },
    });
    if (!call) { res.status(404).json({ error: 'Call not found' }); return; }
    // Stub: returns recordingUrl from DB.
    // Will proxy Exotel API for fresh signed URLs when EXOTEL_SID is configured.
    res.json({ recordingUrl: call.recordingUrl ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
