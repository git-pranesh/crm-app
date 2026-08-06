/**
 * Performance Recalculation Job — runs nightly at 2am.
 * Recalculates per-designer: conversionRate, avgProjectValue, performanceTier.
 *
 * Tier thresholds:
 *   BASIC    — conversion < 20%
 *   STANDARD — conversion 20–40%
 *   PREMIUM  — conversion > 40%
 */

import { Queue, Worker } from 'bullmq';
import { connection } from './index.js';
import { prisma } from '../lib/prisma.js';

const QUEUE_NAME = 'performance-recalc';

export const performanceRecalcQueue = new Queue(QUEUE_NAME, { connection });

export async function schedulePerformanceRecalc() {
  await performanceRecalcQueue.add(
    'nightly-recalc',
    {},
    {
      repeat: { pattern: '0 2 * * *' }, // 2am every night
      jobId: 'performance-recalc-singleton',
    },
  );
  console.log('[jobs] Nightly performance recalc scheduled (0 2 * * *)');
}

export async function runPerformanceRecalc(): Promise<{ updated: number }> {
  console.log('[performance] Running recalculation…');

  const designers = await prisma.user.findMany({
    where: { role: { in: ['DESIGNER', 'CRE'] }, isActive: true },
    select: { id: true },
  });

  let updated = 0;

  for (const designer of designers) {
    const [totalAssigned, totalConverted, avgValue] = await Promise.all([
      prisma.lead.count({ where: { assignedDesignerId: designer.id } }),
      // Conversion counts leads that reached Design in Progress — the funnel's
      // new terminal/incentive-trigger stage (Onboarding no longer counts;
      // HANDED_OVER kept unconditionally for legacy leads that predate the
      // DIP checklist model). Current-funnel DESIGN_IN_PROGRESS leads must
      // additionally have a completed DIP checklist (task #89
      // defense-in-depth — the ONBOARDING_MEETING->DESIGN_IN_PROGRESS
      // stage-gate already refuses this transition otherwise, but this makes
      // the requirement explicit at the incentive-driving query itself).
      prisma.lead.count({
        where: {
          assignedDesignerId: designer.id,
          OR: [
            { stage: 'DESIGN_IN_PROGRESS', dipChecklist: { completedAt: { not: null } } },
            { stage: 'HANDED_OVER' },
          ],
        },
      }),
      prisma.lead.aggregate({
        where: {
          assignedDesignerId: designer.id,
          estimatedValue: { not: null },
        },
        _avg: { estimatedValue: true },
      }),
    ]);

    const conversionRate = totalAssigned > 0 ? totalConverted / totalAssigned : 0;

    let performanceTier: 'BASIC' | 'STANDARD' | 'PREMIUM';
    if (conversionRate > 0.4) performanceTier = 'PREMIUM';
    else if (conversionRate >= 0.2) performanceTier = 'STANDARD';
    else performanceTier = 'BASIC';

    await prisma.user.update({
      where: { id: designer.id },
      data: {
        totalLeadsAssigned: totalAssigned,
        totalLeadsConverted: totalConverted,
        conversionRate,
        avgProjectValue: avgValue._avg.estimatedValue ?? 0,
        performanceTier,
      },
    });

    updated++;
  }

  console.log(`[performance] Done. ${updated} designer(s) recalculated.`);
  return { updated };
}

export const performanceRecalcWorker = new Worker(
  QUEUE_NAME,
  async () => {
    console.log('[performance] Running nightly recalculation…');

    const designers = await prisma.user.findMany({
      where: { role: { in: ['DESIGNER', 'CRE'] }, isActive: true },
      select: { id: true },
    });

    let updated = 0;

    for (const designer of designers) {
      const [totalAssigned, totalConverted, avgValue] = await Promise.all([
        prisma.lead.count({ where: { assignedDesignerId: designer.id } }),
        prisma.lead.count({
          where: {
            assignedDesignerId: designer.id,
            // See runPerformanceRecalc() above for the DIP-checklist
            // defense-in-depth rationale (task #89).
            OR: [
              { stage: 'DESIGN_IN_PROGRESS', dipChecklist: { completedAt: { not: null } } },
              { stage: 'HANDED_OVER' },
            ],
          },
        }),
        prisma.lead.aggregate({
          where: {
            assignedDesignerId: designer.id,
            estimatedValue: { not: null },
          },
          _avg: { estimatedValue: true },
        }),
      ]);

      const conversionRate = totalAssigned > 0
        ? totalConverted / totalAssigned
        : 0;

      let performanceTier: 'BASIC' | 'STANDARD' | 'PREMIUM';
      if (conversionRate > 0.4) performanceTier = 'PREMIUM';
      else if (conversionRate >= 0.2) performanceTier = 'STANDARD';
      else performanceTier = 'BASIC';

      await prisma.user.update({
        where: { id: designer.id },
        data: {
          totalLeadsAssigned: totalAssigned,
          totalLeadsConverted: totalConverted,
          conversionRate,
          avgProjectValue: avgValue._avg.estimatedValue ?? 0,
          performanceTier,
        },
      });

      updated++;
    }

    console.log(`[performance] Done. ${updated} designer(s) recalculated.`);
  },
  { connection },
);
