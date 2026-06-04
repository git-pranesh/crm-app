import { Worker, Queue } from 'bullmq';
import { connection } from './index.js';
import { prisma } from '../lib/prisma.js';
import { createNotification } from '../lib/notifications.js';

const QUEUE_NAME = 'midnight-overdue-check';

export const midnightQueue = new Queue(QUEUE_NAME, { connection });

// Schedule repeatable job at midnight IST (18:30 UTC)
export async function scheduleMidnightJob() {
  await midnightQueue.add(
    'check-overdue-tasks',
    {},
    {
      repeat: { pattern: '30 18 * * *' }, // 00:00 IST = 18:30 UTC
      jobId: 'midnight-overdue-singleton',
    },
  );
  console.log('[jobs] Midnight overdue-task job scheduled (30 18 * * *)');
}

// ── Core logic — callable directly for on-demand triggers ─────────────────────
export async function runMidnightCheck(): Promise<{ markedOverdue: number; details: string[] }> {
  console.log('[jobs] Running midnight overdue-task scan…');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const overdueTasks = await prisma.followUpTask.findMany({
    where: {
      dueDate: { lt: tomorrow },
      isCompleted: false,
      isOverdue: false,
    },
    include: {
      assignedTo: { select: { id: true, name: true, blId: true } },
      lead: { select: { id: true, leadId: true, name: true } },
    },
  });

  if (overdueTasks.length === 0) {
    console.log('[jobs] No overdue tasks found.');
    return { markedOverdue: 0, details: [] };
  }

  await prisma.followUpTask.updateMany({
    where: { id: { in: overdueTasks.map((t) => t.id) } },
    data: { isOverdue: true },
  });

  const details: string[] = [];
  for (const task of overdueTasks) {
    const message = `Task for lead ${task.lead.leadId} (${task.lead.name}) assigned to ${task.assignedTo.name} is overdue.`;

    if (task.assignedTo.blId) {
      await createNotification(task.assignedTo.blId, 'OVERDUE_TASK', message, task.lead.id);
    }

    details.push(`task:${task.id} lead:${task.lead.leadId} assignee:${task.assignedTo.name}`);
  }

  console.log(`[jobs] Marked ${overdueTasks.length} task(s) as overdue and notified managers.`);
  return { markedOverdue: overdueTasks.length, details };
}

export const midnightWorker = new Worker(
  QUEUE_NAME,
  async () => { await runMidnightCheck(); },
  { connection },
);
