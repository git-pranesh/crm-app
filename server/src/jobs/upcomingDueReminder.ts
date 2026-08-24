import { Worker, Queue } from 'bullmq';
import { connection } from './index.js';
import { prisma } from '../lib/prisma.js';
import { createNotification } from '../lib/notifications.js';

/**
 * Batch 14 item 3 — "1 hour before" in-app reminder for follow-up tasks and
 * meetings. Runs every 15 minutes (finer than the 60-minute window itself,
 * so a task/meeting due 61 minutes after the previous run isn't missed) and
 * notifies the assignee once per task/meeting, deduped via notificationLog.
 *
 * Distinct from the existing 15-min taskReminders.ts sweep, which is a
 * same-day/overdue digest — this one targets the precise ~60-minute-out
 * window and also covers meetings, which that sweep does not.
 */

const QUEUE_NAME = 'upcoming-due-reminder';
const WINDOW_MS = 60 * 60 * 1000; // 60 minutes

export const upcomingDueReminderQueue = new Queue(QUEUE_NAME, { connection });

export async function scheduleUpcomingDueReminder() {
  await upcomingDueReminderQueue.add(
    'upcoming-due-check',
    {},
    {
      repeat: { pattern: '*/15 * * * *' }, // every 15 minutes
      jobId: 'upcoming-due-reminder-singleton',
    },
  );
  console.log('[jobs] Upcoming due-soon reminder scheduled (every 15 min)');
}

/** Combine a task's dueDate with its dueTime/timeFrom (HH:MM) into one Date, IST wall-clock. */
function taskDueAt(dueDate: Date, hhmm: string | null): Date | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  // dueDate is stored as a UTC instant representing IST midnight of that
  // calendar day; the IST wall-clock offset is a fixed +5:30, so adding the
  // task's local HH:MM directly (minus the 5:30 already baked into the UTC
  // date) yields the correct UTC instant.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(dueDate.getTime() + h * 60 * 60 * 1000 + m * 60 * 1000 - IST_OFFSET_MS);
}

export async function runUpcomingDueReminder(): Promise<{ taskReminders: number; meetingReminders: number }> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_MS);

  // ── Follow-up tasks with a specific due time, due within the next hour ──────
  const candidateTasks = await prisma.followUpTask.findMany({
    where: {
      isCompleted: false,
      status: 'PENDING',
      dueDate: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), lt: windowEnd },
    },
    include: {
      lead: { select: { id: true, leadId: true, name: true } },
      assignedTo: { select: { id: true, isActive: true } },
    },
  });

  let taskReminders = 0;
  for (const t of candidateTasks) {
    if (!t.assignedTo?.isActive) continue;
    const dueAt = taskDueAt(t.dueDate, t.timeFrom ?? t.dueTime);
    if (!dueAt || dueAt < now || dueAt > windowEnd) continue;

    const already = await prisma.notificationLog.findFirst({
      where: { userId: t.assignedToId, type: 'TASK_DUE_SOON', taskId: t.id },
      select: { id: true },
    });
    if (already) continue;

    await createNotification(
      t.assignedToId,
      'TASK_DUE_SOON',
      `Reminder: follow-up for lead ${t.lead.leadId} (${t.lead.name}) is due in about an hour${t.timeFrom ? ` at ${t.timeFrom}` : ''}`,
      t.leadId,
      dueAt,
      t.id,
    );
    taskReminders++;
  }

  // ── Scheduled meetings starting within the next hour ────────────────────────
  const candidateMeetings = await prisma.meeting.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { gte: now, lt: windowEnd } },
    include: {
      lead: { select: { id: true, leadId: true, name: true, assignedDesignerId: true, assignedBLId: true } },
    },
  });

  let meetingReminders = 0;
  for (const m of candidateMeetings) {
    const recipientIds = [m.lead.assignedDesignerId, m.lead.assignedBLId].filter(
      (id): id is string => !!id,
    );
    if (recipientIds.length === 0) continue;

    const activeRecipients = await prisma.user.findMany({
      where: { id: { in: recipientIds }, isActive: true },
      select: { id: true },
    });

    for (const recipient of activeRecipients) {
      const already = await prisma.notificationLog.findFirst({
        where: { userId: recipient.id, type: 'MEETING_DUE_SOON', leadId: m.lead.id, eventAt: m.scheduledAt },
        select: { id: true },
      });
      if (already) continue;

      await createNotification(
        recipient.id,
        'MEETING_DUE_SOON',
        `Reminder: ${m.type} meeting for lead ${m.lead.leadId} (${m.lead.name}) starts in about an hour`,
        m.lead.id,
        m.scheduledAt,
      );
      meetingReminders++;
    }
  }

  if (taskReminders > 0 || meetingReminders > 0) {
    console.log(`[jobs] Upcoming due-soon: ${taskReminders} task reminder(s), ${meetingReminders} meeting reminder(s).`);
  }
  return { taskReminders, meetingReminders };
}

export const upcomingDueReminderWorker = new Worker(
  QUEUE_NAME,
  async () => { await runUpcomingDueReminder(); },
  { connection },
);
