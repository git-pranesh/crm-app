import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification, notifyManagers } from '../lib/notifications.js';

export const callsRouter = Router({ mergeParams: true });

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
    followUpTask,
  } = req.body as {
    outcome: string;
    duration?: number;
    notes?: string;
    recordingUrl?: string;
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

  // Enforce mandatory follow-up
  if (!followUpTask?.dueDate) {
    res.status(400).json({
      error: 'A follow-up task (dueDate required) must be set before saving the call',
    });
    return;
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
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

    return [newCall, newTask];
  });

  await logActivity(user.id, 'CALL_LOGGED', leadId, { outcome, duration });

  // RNR escalation logic
  const rnrCount = await prisma.call.count({
    where: { leadId, outcome: { in: RNR_OUTCOMES } },
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

// ── GET /api/leads/:leadId/calls ──────────────────────────────────────────────
callsRouter.get('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };

  const calls = await prisma.call.findMany({
    where: { leadId },
    include: { loggedBy: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const rnrCount = calls.filter((c) => RNR_OUTCOMES.includes(c.outcome as any)).length;

  res.json({ calls, rnrCount, needsEscalation: rnrCount >= ESCALATION_THRESHOLD });
});
