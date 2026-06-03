import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';

export const tasksRouter = Router({ mergeParams: true });
export const myTasksRouter = Router();

const taskInclude = {
  assignedTo: { select: { id: true, name: true, role: true } },
  lead: { select: { id: true, leadId: true, name: true, stage: true } },
} as const;

// ── GET /api/leads/:leadId/tasks ──────────────────────────────────────────────
tasksRouter.get('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };

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

  const { dueDate, dueTime, assignedToId } = req.body as {
    dueDate?: string;
    dueTime?: string;
    assignedToId?: string;
  };

  if (!dueDate) {
    res.status(400).json({ error: 'dueDate is required' });
    return;
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const task = await prisma.followUpTask.create({
    data: {
      leadId,
      assignedToId: assignedToId ?? user.id,
      dueDate: new Date(dueDate),
      dueTime,
    },
    include: taskInclude,
  });

  await logActivity(user.id, 'TASK_CREATED', leadId, { dueDate, assignedToId });

  res.status(201).json({ task });
});

// ── GET /api/tasks/my ─────────────────────────────────────────────────────────
myTasksRouter.get('/my', verifyToken, async (req, res) => {
  const user = req.user!;
  const { status } = req.query as { status?: string };

  const where: any = { assignedToId: user.id };
  if (status === 'overdue') where.isOverdue = true;
  else if (status === 'completed') where.isCompleted = true;
  else if (status === 'upcoming') {
    where.isCompleted = false;
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

// ── PATCH /api/tasks/:id/complete ─────────────────────────────────────────────
myTasksRouter.patch('/:id/complete', verifyToken, async (req, res) => {
  const { id } = req.params;
  const user = req.user!;

  const task = await prisma.followUpTask.findUnique({ where: { id } });
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  if (task.assignedToId !== user.id && !['BL', 'BRANCH_HEAD'].includes(user.role)) {
    res.status(403).json({ error: 'Not authorized to complete this task' });
    return;
  }

  const updated = await prisma.followUpTask.update({
    where: { id },
    data: { isCompleted: true, isOverdue: false, completedAt: new Date() },
    include: taskInclude,
  });

  await logActivity(user.id, 'TASK_COMPLETED', task.leadId, { taskId: id });

  res.json({ task: updated });
});
