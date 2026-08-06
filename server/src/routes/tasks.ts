import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';
import { sendEmail } from '../lib/email.js';
import { sendWhatsAppMessage, normalizePhoneE164 } from '../lib/whatsapp.js';
import { isAuthorizedForLead, isAuthorizedToAssignTask } from '../lib/leadAuth.js';

export const tasksRouter = Router({ mergeParams: true });
export const myTasksRouter = Router();

const taskInclude = {
  assignedTo: { select: { id: true, name: true, role: true } },
  lead: { select: { id: true, leadId: true, name: true, stage: true, email: true, phone: true } },
} as const;

const TASK_TYPES = ['INTERNAL', 'EXTERNAL'] as const;

// Local midnight "today" — used to block past-dated tasks without punishing same-day creation.
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function notifyExternalTask(lead: { id: string; leadId: string; name: string; email: string | null; phone: string | null }, task: { dueDate: Date; dueTime: string | null; agenda: string | null }) {
  const dueStr = task.dueDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  if (lead.email) {
    await sendEmail({
      to: lead.email,
      subject: `Upcoming follow-up — Interiors by DeX`,
      html: `<p>Dear ${lead.name},</p><p>We have a follow-up scheduled with you on <strong>${dueStr}${task.dueTime ? ` at ${task.dueTime}` : ''}</strong>.</p>${task.agenda ? `<p>Agenda: ${task.agenda}</p>` : ''}<p>Team Interiors by DeX</p>`,
    }).catch(() => {});
  }
  if (lead.phone) {
    await sendWhatsAppMessage(
      normalizePhoneE164(lead.phone),
      `Hi ${lead.name}, we have a follow-up scheduled with you on ${dueStr}${task.dueTime ? ` at ${task.dueTime}` : ''}.${task.agenda ? ` Agenda: ${task.agenda}` : ''} — Team Interiors by DeX`,
    ).catch(() => {});
  }
}

// ── GET /api/leads/:leadId/tasks ──────────────────────────────────────────────
tasksRouter.get('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedDesignerId: true, assignedBLId: true },
  });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  if (!(await isAuthorizedForLead(lead, user))) {
    res.status(403).json({ error: 'Not authorised to view tasks for this lead' });
    return;
  }

  const tasks = await prisma.followUpTask.findMany({
    where: { leadId },
    include: taskInclude,
    orderBy: [{ isOverdue: 'desc' }, { isCompleted: 'asc' }, { dueDate: 'asc' }],
  });

  res.json({ tasks });
});

// ── POST /api/leads/:leadId/tasks ─────────────────────────────────────────────
tasksRouter.post('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  const { dueDate, dueTime, timeFrom, timeTo, assignedToId, taskType, agenda } = req.body as {
    dueDate?: string;
    dueTime?: string;
    timeFrom?: string;
    timeTo?: string;
    assignedToId?: string;
    taskType?: string;
    agenda?: string;
  };

  if (!dueDate) {
    res.status(400).json({ error: 'dueDate is required' });
    return;
  }

  const parsedDueDate = new Date(dueDate);
  if (Number.isNaN(parsedDueDate.getTime())) {
    res.status(400).json({ error: 'dueDate is invalid' });
    return;
  }
  if (parsedDueDate < startOfToday()) {
    res.status(400).json({ error: 'A task cannot be created with a due date in the past' });
    return;
  }

  if (taskType && !TASK_TYPES.includes(taskType as any)) {
    res.status(400).json({ error: `taskType must be one of: ${TASK_TYPES.join(', ')}` });
    return;
  }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, leadId: true, name: true, email: true, phone: true, assignedDesignerId: true, assignedBLId: true },
  });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  if (!(await isAuthorizedForLead(lead, user))) {
    res.status(403).json({ error: 'Not authorised to create tasks for this lead' });
    return;
  }

  const resolvedAssigneeId = assignedToId ?? user.id;
  if (!(await isAuthorizedToAssignTask(resolvedAssigneeId, user))) {
    res.status(403).json({ error: 'Not authorised to assign a task to this user' });
    return;
  }

  const resolvedTimeFrom = timeFrom ?? dueTime;

  const task = await prisma.followUpTask.create({
    data: {
      leadId,
      assignedToId: resolvedAssigneeId,
      dueDate: parsedDueDate,
      dueTime: resolvedTimeFrom,
      timeFrom: resolvedTimeFrom,
      timeTo: timeTo,
      taskType: (taskType as any) ?? undefined,
      agenda: agenda?.trim() || undefined,
    },
    include: taskInclude,
  });

  await logActivity(user.id, 'TASK_CREATED', leadId, { dueDate, assignedToId, taskType });

  if (task.assignedToId !== user.id) {
    const dueStr = parsedDueDate.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
    await createNotification(
      task.assignedToId,
      'TASK_SCHEDULED',
      `Task scheduled for ${lead.name} (${lead.leadId}) — due ${dueStr}${resolvedTimeFrom ? ` at ${resolvedTimeFrom}` : ''}`,
      leadId,
    );
  }

  if (taskType === 'EXTERNAL') {
    await notifyExternalTask(lead, { dueDate: parsedDueDate, dueTime: resolvedTimeFrom ?? null, agenda: agenda ?? null });
  }

  res.status(201).json({ task });
});

// ── GET /api/tasks/my ─────────────────────────────────────────────────────────
myTasksRouter.get('/my', verifyToken, async (req, res) => {
  const user = req.user!;
  const { status } = req.query as { status?: string };

  const where: any = { assignedToId: user.id };
  // status:'PENDING' excludes RESCHEDULED/NOT_DONE archive rows, which keep
  // isCompleted:false but are terminal and must never appear as "overdue".
  if (status === 'overdue') { where.isOverdue = true; where.status = 'PENDING'; }
  else if (status === 'completed') where.status = 'COMPLETED';
  else if (status === 'not_done') where.status = 'NOT_DONE';
  else if (status === 'rescheduled') where.status = 'RESCHEDULED';
  else if (status === 'upcoming') {
    where.status = 'PENDING';
    where.isOverdue = false;
  }

  const tasks = await prisma.followUpTask.findMany({
    where,
    include: taskInclude,
    orderBy: [{ isOverdue: 'desc' }, { dueDate: 'asc' }],
  });

  res.json({ tasks });
});

// ── GET /api/tasks/team ───────────────────────────────────────────────────────
myTasksRouter.get(
  '/team',
  verifyToken,
  requireRole('BL', 'BRANCH_HEAD'),
  async (req, res) => {
    const user = req.user!;

    let teamMemberIds: string[] = [];

    if (user.role === 'BL') {
      const members = await prisma.user.findMany({
        where: { blId: user.id },
        select: { id: true },
      });
      teamMemberIds = members.map((m) => m.id);
    }
    // BRANCH_HEAD: no filter → all users

    const tasks = await prisma.followUpTask.findMany({
      where: user.role === 'BL' ? { assignedToId: { in: teamMemberIds } } : {},
      include: taskInclude,
      orderBy: [{ isOverdue: 'desc' }, { dueDate: 'asc' }],
    });

    res.json({ tasks });
  },
);

function canActOnTask(task: { assignedToId: string }, user: { id: string; role: string }) {
  return task.assignedToId === user.id || ['BL', 'BRANCH_HEAD'].includes(user.role);
}

// ── PATCH /api/tasks/:id/complete ─────────────────────────────────────────────
// A required "outcome" note must be supplied before a task can be marked done.
// Follow-up tasks (unlike meetings/calls) may be backdated — completedAt may be
// any date up to and including now, but never in the future.
myTasksRouter.patch('/:id/complete', verifyToken, async (req, res) => {
  const { id } = req.params;
  const user = req.user!;
  const { outcome, completedAt } = req.body as { outcome?: string; completedAt?: string };

  const task = await prisma.followUpTask.findUnique({ where: { id } });
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  if (!canActOnTask(task, user)) {
    res.status(403).json({ error: 'Not authorized to complete this task' });
    return;
  }
  if (task.status !== 'PENDING') {
    res.status(400).json({ error: `Cannot complete a task that is already ${task.status}` });
    return;
  }
  if (!outcome?.trim()) {
    res.status(400).json({ error: 'An outcome note is required to complete this task' });
    return;
  }

  // Reps must not close a follow-up without doing anything: require at least
  // one lead activity logged strictly after the task was created, excluding
  // the task's own lifecycle events (TASK_CREATED/TASK_COMPLETED). Flows that
  // spawn a task as a side effect of an activity (e.g. calls.ts) log that
  // activity at the task's own createdAt timestamp, so it never satisfies
  // this guard by itself.
  const qualifyingActivity = await prisma.activityLog.findFirst({
    where: {
      leadId: task.leadId,
      createdAt: { gt: task.createdAt },
      action: { notIn: ['TASK_CREATED', 'TASK_COMPLETED'] },
    },
    select: { id: true },
  });
  if (!qualifyingActivity) {
    res.status(400).json({ error: 'Log a call, meeting, or other activity for this lead before completing the task' });
    return;
  }

  let resolvedCompletedAt = new Date();
  if (completedAt) {
    const parsed = new Date(completedAt);
    if (Number.isNaN(parsed.getTime())) {
      res.status(400).json({ error: 'completedAt is invalid' });
      return;
    }
    if (parsed.getTime() > Date.now()) {
      res.status(400).json({ error: 'completedAt cannot be in the future' });
      return;
    }
    resolvedCompletedAt = parsed;
  }

  const updated = await prisma.followUpTask.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      isCompleted: true,
      isOverdue: false,
      outcome: outcome.trim(),
      completedAt: resolvedCompletedAt,
    },
    include: taskInclude,
  });

  await logActivity(user.id, 'TASK_COMPLETED', task.leadId, { taskId: id, outcome: outcome.trim() });

  res.json({ task: updated });
});

// ── PATCH /api/tasks/:id/not-done ─────────────────────────────────────────────
myTasksRouter.patch('/:id/not-done', verifyToken, async (req, res) => {
  const { id } = req.params;
  const user = req.user!;
  const { outcome } = req.body as { outcome?: string };

  const task = await prisma.followUpTask.findUnique({ where: { id } });
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  if (!canActOnTask(task, user)) {
    res.status(403).json({ error: 'Not authorized to update this task' });
    return;
  }
  if (task.status !== 'PENDING') {
    res.status(400).json({ error: `Cannot mark not-done a task that is already ${task.status}` });
    return;
  }
  if (!outcome?.trim()) {
    res.status(400).json({ error: 'An outcome note is required to mark this task not done' });
    return;
  }

  const updated = await prisma.followUpTask.update({
    where: { id },
    data: { status: 'NOT_DONE', isCompleted: false, outcome: outcome.trim() },
    include: taskInclude,
  });

  await logActivity(user.id, 'TASK_NOT_DONE', task.leadId, { taskId: id, outcome: outcome.trim() });

  res.json({ task: updated });
});

// ── PATCH /api/tasks/:id/reschedule ───────────────────────────────────────────
myTasksRouter.patch('/:id/reschedule', verifyToken, async (req, res) => {
  const { id } = req.params;
  const user = req.user!;
  const { dueDate, dueTime, timeFrom, timeTo, reason } = req.body as {
    dueDate?: string;
    dueTime?: string;
    timeFrom?: string;
    timeTo?: string;
    reason?: string;
  };

  const task = await prisma.followUpTask.findUnique({ where: { id } });
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  if (!canActOnTask(task, user)) {
    res.status(403).json({ error: 'Not authorized to reschedule this task' });
    return;
  }
  if (task.status !== 'PENDING') {
    res.status(400).json({ error: `Cannot reschedule a task that is already ${task.status}` });
    return;
  }
  if (!dueDate || !reason?.trim()) {
    res.status(400).json({ error: 'dueDate and reason are required to reschedule' });
    return;
  }

  const parsedDueDate = new Date(dueDate);
  if (Number.isNaN(parsedDueDate.getTime()) || parsedDueDate < startOfToday()) {
    res.status(400).json({ error: 'The new due date must be today or later' });
    return;
  }

  const resolvedTimeFrom = timeFrom ?? dueTime;

  // Archive the original as RESCHEDULED (a terminal, non-actionable status —
  // mirrors the meeting reschedule pattern) and create a fresh PENDING
  // replacement carrying the new date/time, rather than mutating the
  // original task back to PENDING in place. This keeps the task's own
  // history immutable once archived and makes the RESCHEDULED status/badge
  // actually reachable, instead of every reschedule silently reusing the
  // same row and status.
  const { archived, replacement } = await prisma.$transaction(async (tx) => {
    const archivedTask = await tx.followUpTask.update({
      where: { id },
      data: {
        status: 'RESCHEDULED',
        isCompleted: false,
        isOverdue: false,
        outcome: reason.trim(),
      },
      include: taskInclude,
    });
    const replacementTask = await tx.followUpTask.create({
      data: {
        leadId: task.leadId,
        assignedToId: task.assignedToId,
        dueDate: parsedDueDate,
        dueTime: resolvedTimeFrom,
        timeFrom: resolvedTimeFrom,
        timeTo: timeTo ?? undefined,
        taskType: task.taskType,
        agenda: task.agenda,
        originatingCallId: task.originatingCallId,
        // Carry forward the full prior chain so the active task always
        // reflects every reschedule, not just the immediately preceding one.
        rescheduleHistory: [
          ...(Array.isArray(task.rescheduleHistory) ? task.rescheduleHistory : []),
          {
            dueDate: task.dueDate,
            dueTime: task.dueTime,
            reason: reason.trim(),
            rescheduledAt: new Date().toISOString(),
            previousTaskId: task.id,
          },
        ],
      },
      include: taskInclude,
    });
    await tx.activityLog.create({
      data: {
        userId: user.id,
        action: 'TASK_RESCHEDULED',
        leadId: task.leadId,
        meta: { originalTaskId: id, replacementTaskId: replacementTask.id, dueDate, reason: reason.trim() },
      },
    });
    return { archived: archivedTask, replacement: replacementTask };
  });

  if (task.taskType === 'EXTERNAL') {
    const lead = await prisma.lead.findUnique({
      where: { id: task.leadId },
      select: { id: true, leadId: true, name: true, email: true, phone: true },
    });
    if (lead) {
      await notifyExternalTask(lead, { dueDate: parsedDueDate, dueTime: resolvedTimeFrom ?? null, agenda: task.agenda });
    }
  }

  res.json({ task: archived, replacementTask: replacement });
});
