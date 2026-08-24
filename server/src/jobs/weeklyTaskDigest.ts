import { Worker, Queue } from 'bullmq';
import { connection } from './index.js';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email.js';
import { IST_TZ } from '../lib/istTime.js';

/**
 * Batch 14 item 3 — weekly digest emailed every Tuesday morning (IST) to
 * every active user who has at least one open (PENDING, not completed)
 * follow-up task, listing all of them in one place. This is an internal
 * reminder to staff, not client-facing mail, so it goes straight through
 * sendEmail rather than the admin-editable client mail-template registry.
 */

const QUEUE_NAME = 'weekly-task-digest';

export const weeklyTaskDigestQueue = new Queue(QUEUE_NAME, { connection });

export async function scheduleWeeklyTaskDigest() {
  await weeklyTaskDigestQueue.add(
    'weekly-digest',
    {},
    {
      repeat: { pattern: '30 2 * * 2' }, // Tuesday 08:00 IST = 02:30 UTC
      jobId: 'weekly-task-digest-singleton',
    },
  );
  console.log('[jobs] Weekly task digest scheduled (Tuesday 08:00 IST)');
}

export async function runWeeklyTaskDigest(): Promise<{ emailsSent: number }> {
  console.log('[jobs] Running weekly task digest…');

  const openTasks = await prisma.followUpTask.findMany({
    where: { isCompleted: false, status: 'PENDING' },
    include: {
      lead: { select: { leadId: true, name: true } },
      assignedTo: { select: { id: true, name: true, email: true, isActive: true } },
    },
    orderBy: { dueDate: 'asc' },
  });

  const byUser = new Map<string, { name: string; email: string; tasks: typeof openTasks }>();
  for (const t of openTasks) {
    if (!t.assignedTo?.isActive || !t.assignedTo.email) continue;
    const entry = byUser.get(t.assignedTo.id) ?? { name: t.assignedTo.name, email: t.assignedTo.email, tasks: [] };
    entry.tasks.push(t);
    byUser.set(t.assignedTo.id, entry);
  }

  let emailsSent = 0;
  for (const { name, email, tasks } of byUser.values()) {
    const rows = tasks
      .map((t) => {
        const dueStr = t.dueDate.toLocaleDateString('en-IN', { timeZone: IST_TZ, day: 'numeric', month: 'short' });
        const overdueTag = t.isOverdue ? ' <strong style="color:#b91c1c">(overdue)</strong>' : '';
        return `<li>${t.lead.leadId} — ${t.lead.name}: due ${dueStr}${t.dueTime ? ` at ${t.dueTime}` : ''}${overdueTag}${t.agenda ? ` — ${t.agenda}` : ''}</li>`;
      })
      .join('');
    const html = `
      <p>Hi ${name},</p>
      <p>Here's your weekly summary of open follow-up tasks (${tasks.length}):</p>
      <ul>${rows}</ul>
      <p>— CRM automated reminder</p>
    `;
    try {
      await sendEmail({ to: email, subject: `Your open follow-up tasks (${tasks.length})`, html });
      emailsSent++;
    } catch (e) {
      console.warn(`[weekly-task-digest] failed to email ${email}:`, (e as Error).message);
    }
  }

  console.log(`[jobs] Weekly task digest sent to ${emailsSent} user(s).`);
  return { emailsSent };
}

export const weeklyTaskDigestWorker = new Worker(
  QUEUE_NAME,
  async () => { await runWeeklyTaskDigest(); },
  { connection },
);
