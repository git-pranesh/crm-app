import { prisma } from '../lib/prisma.js';
import { createNotification } from '../lib/notifications.js';
import { IST_TZ as TZ, istDayBounds } from '../lib/istTime.js';

/**
 * dueDate carries the calendar date; the actual time-of-day lives separately
 * in dueTime ("HH:MM"). Combining them gives a single instant that uniquely
 * identifies a task's due moment, so two different tasks for the same lead
 * due on the same day at different times don't collide in the dedupe check.
 */
function dueInstant(dueDate: Date, dueTime: string | null): Date {
  if (!dueTime) return dueDate;
  const [h, m] = dueTime.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return dueDate;
  const combined = new Date(dueDate);
  combined.setHours(h, m, 0, 0);
  return combined;
}

/**
 * Sends an in-app reminder to the assignee for every incomplete follow-up task
 * due today (IST) or overdue. Deduped: max one reminder per task per IST day.
 */
export async function runTaskReminderSweep() {
  const { start, end } = istDayBounds();

  const tasks = await prisma.followUpTask.findMany({
    // status: 'PENDING' excludes RESCHEDULED/NOT_DONE archive rows — those
    // keep isCompleted:false but are terminal and must not generate reminders.
    where: { isCompleted: false, status: 'PENDING', dueDate: { lt: end } },
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
       ? `Reminder: follow-up for lead ${t.lead.leadId} (${t.lead.name}) is due today${t.dueTime ? ` at ${t.dueTime}` : ''}`
       : `Reminder: follow-up for lead ${t.lead.leadId} (${t.lead.name}) is overdue since ${t.dueDate.toLocaleDateString('en-IN', { timeZone: TZ })}`;

    const dueAt = dueInstant(t.dueDate, t.dueTime);

    // Dedupe: one TASK_DUE reminder per task per IST day. Keyed on the task's
    // own due date+time (stored as eventAt) rather than embedding the task id
    // in the user-visible message text — dueAt combines dueDate and dueTime so
    // two same-day tasks for the same lead at different times don't collide.
    const already = await prisma.notificationLog.findFirst({
      where: {
        userId: t.assignedToId,
        leadId: t.leadId,
        type: 'TASK_DUE',
        createdAt: { gte: start },
        eventAt: dueAt,
      },
      select: { id: true },
    });
    if (already) continue;

    await createNotification(t.assignedToId, 'TASK_DUE', message, t.leadId, dueAt);
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
