import { Worker, Queue } from 'bullmq';
import { connection } from './index.js';
import { prisma } from '../lib/prisma.js';
import { createNotification } from '../lib/notifications.js';
import { logActivity } from '../lib/activityLog.js';

const QUEUE_NAME = 'sla-engine';

export const slaQueue = new Queue(QUEUE_NAME, { connection });

const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID ?? 'system';

async function resolveSystemUserId(): Promise<string> {
  if (SYSTEM_USER_ID !== 'system') return SYSTEM_USER_ID;
  const bh = await prisma.user.findFirst({ where: { role: 'BRANCH_HEAD', isActive: true }, select: { id: true } });
  return bh?.id ?? SYSTEM_USER_ID;
}

// ── SLA rules ─────────────────────────────────────────────────────────────────
const SLA_RULES = [
  {
    rule: 'FIRST_CONTACT',
    label: 'First call within 24 hours',
    check: async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return prisma.lead.findMany({
        where: {
          createdAt: { lt: cutoff },
          calls: { none: {} },
          stage: { notIn: ['INACTIVE', 'ON_HOLD', 'HANDED_OVER'] },
          isSLABreached: false,
        },
        select: { id: true, leadId: true, assignedBLId: true, assignedDesignerId: true },
      });
    },
  },
  {
    rule: 'LEAD_TO_MQL',
    label: 'Move to MQL within 5 days',
    check: async () => {
      const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      return prisma.lead.findMany({
        where: {
          stage: 'EFFECTIVE_LEAD',
          updatedAt: { lt: cutoff },
          isSLABreached: false,
        },
        select: { id: true, leadId: true, assignedBLId: true, assignedDesignerId: true },
      });
    },
  },
  {
    rule: 'MQL_TO_DQL',
    label: 'Schedule DQL within 5 days of MQL',
    check: async () => {
      const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      return prisma.lead.findMany({
        where: {
          stage: 'MQL',
          updatedAt: { lt: cutoff },
          meetings: { none: { type: 'DQL' } },
          isSLABreached: false,
        },
        select: { id: true, leadId: true, assignedBLId: true, assignedDesignerId: true },
      });
    },
  },
  {
    rule: 'PROPOSAL_TO_PP',
    label: 'Schedule PP within 2 days of Proposal Ready',
    check: async () => {
      const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      return prisma.lead.findMany({
        where: {
          stage: 'PROPOSAL_READY',
          updatedAt: { lt: cutoff },
          meetings: { none: { type: 'PP' } },
          isSLABreached: false,
        },
        select: { id: true, leadId: true, assignedBLId: true, assignedDesignerId: true },
      });
    },
  },
];

// ── Core logic — callable directly for on-demand triggers ─────────────────────
export async function runSLACheck(): Promise<{ totalBreaches: number; details: string[] }> {
  console.log('[sla] Running SLA check…');
  let totalBreaches = 0;
  const details: string[] = [];
  const systemUserId = await resolveSystemUserId();

  for (const { rule, label, check } of SLA_RULES) {
    const breachedLeads = await check();

    for (const lead of breachedLeads) {
      const existing = await prisma.sLABreach.findFirst({
        where: { leadId: lead.id, rule, resolvedAt: null },
      });
      if (existing) continue;

      await prisma.sLABreach.create({
        data: { leadId: lead.id, rule },
      });

      await prisma.lead.update({
        where: { id: lead.id },
        data: { isSLABreached: true },
      });

      const message = `SLA breach: "${label}" for lead ${lead.leadId}`;

      if (lead.assignedBLId) {
        await createNotification(lead.assignedBLId, 'SLA_BREACH', message, lead.id);
      }

      const branchHeads = await prisma.user.findMany({
        where: { role: 'BRANCH_HEAD', isActive: true },
        select: { id: true },
      });
      for (const bh of branchHeads) {
        await createNotification(bh.id, 'SLA_BREACH', message, lead.id);
      }

      await logActivity(systemUserId, 'SLA_BREACH', lead.id, { rule, label });
      details.push(`${lead.leadId}: ${rule}`);
      totalBreaches++;
    }
  }

  console.log(`[sla] Done. ${totalBreaches} new breach(es) created.`);
  return { totalBreaches, details };
}

// ── Schedule hourly job ───────────────────────────────────────────────────────
export async function scheduleSLACheck() {
  await slaQueue.add(
    'hourly-sla-check',
    {},
    {
      repeat: { pattern: '0 * * * *' }, // every hour at :00
      jobId: 'sla-check-singleton',
    },
  );
  console.log('[jobs] Hourly SLA check scheduled (0 * * * *)');
}

// ── SLA worker ────────────────────────────────────────────────────────────────
export const slaWorker = new Worker(
  QUEUE_NAME,
  async () => { await runSLACheck(); },
  { connection },
);
