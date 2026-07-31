import multer from 'multer';
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { createNotification, notifyManagers } from '../lib/notifications.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { isAuthorizedForLead } from '../lib/leadAuth.js';

export const callsRouter = Router({ mergeParams: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const CALL_ATTACHMENT_TYPES = ['Lifestyle Capture', 'Proposal', 'Pitch Presentation'] as const;

const RNR_OUTCOMES = ['RNR_1', 'RNR_2', 'RNR_3', 'RNR_4', 'RNR_5'] as const;
const ESCALATION_THRESHOLD = 5;
const INACTIVATION_MONTHS = 3;

// ── POST /api/leads/:leadId/calls ─────────────────────────────────────────────
callsRouter.post('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  const {
    outcome,
    duration,
    notes,
    recordingUrl,
    agenda,
    location,
    calledAt,
    attachments,
    nextPlanOfAction,
    followUpTask,
  } = req.body as {
    outcome: string;
    duration?: number;
    notes?: string;
    recordingUrl?: string;
    agenda?: string;
    location?: string;
    calledAt?: string;
    attachments?: { type: string; fileUrl?: string }[];
    nextPlanOfAction?: string;
    followUpTask?: { dueDate: string; dueTime?: string; assignedToId?: string };
  };

  if (!outcome) {
    res.status(400).json({ error: 'outcome is required' });
    return;
  }

  const validOutcomes = ['ANSWERED', 'RNR_1', 'RNR_2', 'RNR_3', 'RNR_4', 'RNR_5', 'CALLBACK'];
  if (!validOutcomes.includes(outcome)) {
    res.status(400).json({ error: `outcome must be one of: ${validOutcomes.join(', ')}` });
    return;
  }

  // Call notes are mandatory
  if (!notes?.trim()) {
    res.status(400).json({ error: 'Call notes are required' });
    return;
  }

  // Enforce mandatory follow-up with both date and time
  if (!followUpTask?.dueDate || !followUpTask?.dueTime) {
    res.status(400).json({
      error: 'A follow-up task with due date and time must be set before saving the call',
    });
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, leadId: true, name: true, phone: true, createdAt: true, assignedDesignerId: true, assignedBLId: true },
  });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  if (!(await isAuthorizedForLead(lead, user))) {
    res.status(403).json({ error: 'Not authorised to log calls for this lead' });
    return;
  }

  // Create call + follow-up task in a transaction
  const [call, task] = await prisma.$transaction(async (tx) => {
    const newCall = await tx.call.create({
      data: {
        leadId,
        loggedById: user.id,
        outcome: outcome as any,
        duration,
        notes,
        recordingUrl,
        agenda: agenda?.trim() || undefined,
        location: location?.trim() || undefined,
        calledAt: calledAt ? new Date(calledAt) : undefined,
        attachments: attachments ?? undefined,
        nextPlanOfAction: nextPlanOfAction?.trim() || undefined,
      },
    });

    const newTask = await tx.followUpTask.create({
      data: {
        leadId,
        assignedToId: followUpTask.assignedToId ?? user.id,
        dueDate: new Date(followUpTask.dueDate),
        dueTime: followUpTask.dueTime,
      },
    });

    // Log CALL_LOGGED with the same timestamp as the task so this call does
    // not count as "activity after the task was created" (completion guard
    // uses a strictly-greater comparison).
    await tx.activityLog.create({
      data: {
        userId: user.id,
        action: 'CALL_LOGGED',
        leadId,
        meta: { outcome, duration },
        createdAt: newTask.createdAt,
      },
    });

    return [newCall, newTask];
  });

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

  res.status(201).json({ call, followUpTask: task, needsEscalation, needsInactivationPrompt });
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

  res.json({ calls, rnrCount, needsEscalation: rnrCount >= ESCALATION_THRESHOLD });
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
        select: { id: true, assignedDesignerId: true, assignedBLId: true },
      });
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      if (!(await isAuthorizedForLead(lead, req.user!))) {
        res.status(403).json({ error: 'Not authorised to upload files for this lead' });
        return;
      }

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
