import { prisma } from '../lib/prisma.js';
import { createNotification } from '../lib/notifications.js';

const TZ = 'Asia/Kolkata';

/** Start of "today" in IST, expressed as a UTC Date. */
function istDayBounds(now = new Date()) {
  const istNow = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const offsetMs = istNow.getTime() - now.getTime();
  const istStart = new Date(istNow);
  istStart.setHours(0, 0, 0, 0);
  const start = new Date(istStart.getTime() - offsetMs);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Sends an in-app reminder to the assignee for every incomplete follow-up task
 * due today (IST) or overdue. Deduped: max one reminder per task per IST day.
 */
export async function runTaskReminderSweep() {
  const { start, end } = istDayBounds();

  const tasks = await prisma.followUpTask.findMany({
    where: { isCompleted: false, dueDate: { lt: end } },
    include: {
      lead: { select: { id: true, leadId: true, name: true } },
      assignedTo: { select: { id: true, isActive: true } },
    },
  });

  let sent = 0;
  for (const t of tasks) {
    if (!t.assignedTo?.isActive) continue;

    const dueToday = t.dueDate >= start;
    const message = dueToday
      ? `Reminder: follow-up for lead ${t.lead.leadId} (${t.lead.name}) is due today${t.dueTime ? ` at ${t.dueTime}` : ''} [task:${t.id}]`
      : `Reminder: follow-up for lead ${t.lead.leadId} (${t.lead.name}) is overdue since ${t.dueDate.toLocaleDateString('en-IN', { timeZone: TZ })} [task:${t.id}]`;

    // Dedupe: one TASK_DUE reminder per task per IST day
    const already = await prisma.notificationLog.findFirst({
      where: {
        userId: t.assignedToId,
        type: 'TASK_DUE',
        createdAt: { gte: start },
        message: { contains: `[task:${t.id}]` },
      },
      select: { id: true },
    });
    if (already) continue;

    await createNotification(t.assignedToId, 'TASK_DUE', message, t.leadId);
    sent++;
  }
  if (sent > 0) console.log(`[task-reminders] sent ${sent} reminder(s)`);
  return sent;
}

/** In-process loop — intentionally not BullMQ (Redis quota constraints). */
export function startTaskReminderLoop(intervalMs = 15 * 60 * 1000) {
  runTaskReminderSweep().catch((e) => console.warn('[task-reminders]', e.message));
  setInterval(() => {
    runTaskReminderSweep().catch((e) => console.warn('[task-reminders]', e.message));
  }, intervalMs);
}
