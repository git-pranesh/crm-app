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
export async function runMidnightCheck(): Promise<{ markedOverdue: number; reopenNotified: number; details: string[] }> {
  console.log('[jobs] Running midnight overdue-task scan…');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // ── 1. Overdue follow-up tasks ─────────────────────────────────────────────
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

  if (overdueTasks.length > 0) {
    await prisma.followUpTask.updateMany({
      where: { id: { in: overdueTasks.map((t) => t.id) } },
      data: { isOverdue: true },
    });
  }

  const details: string[] = [];
  for (const task of overdueTasks) {
    const message = `Task for lead ${task.lead.leadId} (${task.lead.name}) assigned to ${task.assignedTo.name} is overdue.`;
    if (task.assignedTo.blId) {
      await createNotification(task.assignedTo.blId, 'OVERDUE_TASK', message, task.lead.id);
    }
    details.push(`task:${task.id} lead:${task.lead.leadId} assignee:${task.assignedTo.name}`);
  }

  // ── 2. ON_HOLD reopen alerts — notify designer when reopen date arrives ────
  const onHoldLeads = await prisma.lead.findMany({
    where: {
      stage: 'ON_HOLD',
      onHoldRevivalDate: { lte: tomorrow },
      assignedDesignerId: { not: null },
    },
    select: { id: true, leadId: true, name: true, assignedDesignerId: true, onHoldRevivalDate: true },
  });

  let reopenNotified = 0;
  for (const lead of onHoldLeads) {
    if (!lead.assignedDesignerId) continue;

    // Idempotency: skip if we already sent an ON_HOLD_REOPEN notification
    // for this lead today (prevents duplicate alerts on repeated midnight runs).
    const alreadyNotifiedToday = await prisma.notificationLog.findFirst({
      where: {
        leadId: lead.id,
        type: 'ON_HOLD_REOPEN',
        createdAt: { gte: today },
      },
      select: { id: true },
    });
    if (alreadyNotifiedToday) continue;

    const message = `Lead ${lead.leadId} (${lead.name}) is due for reactivation — the on-hold reopen date has arrived. Please review and reactivate if appropriate.`;
    try {
      await createNotification(lead.assignedDesignerId, 'ON_HOLD_REOPEN', message, lead.id);
      details.push(`reopen:${lead.leadId}`);
      reopenNotified++;
    } catch (e) {
      console.warn(`[jobs] Failed to send ON_HOLD_REOPEN for lead ${lead.leadId}:`, e);
    }
  }

  console.log(`[jobs] Marked ${overdueTasks.length} task(s) as overdue; sent ${reopenNotified} on-hold reopen alert(s).`);
  return { markedOverdue: overdueTasks.length, reopenNotified, details };
}

export const midnightWorker = new Worker(
  QUEUE_NAME,
  async () => { await runMidnightCheck(); },
  { connection },
);
