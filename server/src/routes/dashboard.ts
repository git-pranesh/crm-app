import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';

export const dashboardRouter = Router();

const PIPELINE_STAGES = [
  'EFFECTIVE_LEAD', 'MQL', 'DQL',
  'PROPOSAL_READY', 'PROPOSAL_PRESENTED', 'ONBOARDING',
] as const;

function startOfDay() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function startOfWeek() {
  const d = startOfDay();
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

dashboardRouter.get('/', verifyToken, async (req, res) => {
  const user = req.user!;

  // ── Build lead filter based on role ─────────────────────────────────────────
  let leadWhere: any = {};
  let teamUserIds: string[] = [user.id];

  if (user.role === 'DESIGNER' || user.role === 'CRE') {
    leadWhere = { assignedDesignerId: user.id };
    teamUserIds = [user.id];
  } else if (user.role === 'BL') {
    const members = await prisma.user.findMany({
      where: { blId: user.id, isActive: true },
      select: { id: true },
    });
    teamUserIds = [user.id, ...members.map((m) => m.id)];
    leadWhere = { assignedDesignerId: { in: members.map((m) => m.id) } };
  }
  // BRANCH_HEAD / ADMIN: no filter

  const today = startOfDay();
  const week = startOfWeek();
  const month = startOfMonth();

  // ── Parallel queries ─────────────────────────────────────────────────────────
  const [
    totalLeads,
    leadsToday,
    leadsThisWeek,
    leadsThisMonth,
    stageCounts,
    sourceCounts,
    slaBreaches,
    callsToday,
    stagesMovedToday,
    tasksCompletedToday,
    activeLeads,
    onboardingLeads,
    ppMeetingsDone,
  ] = await Promise.all([
    prisma.lead.count({ where: leadWhere }),
    prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: today } } }),
    prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: week } } }),
    prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: month } } }),
    prisma.lead.groupBy({ by: ['stage'], where: leadWhere, _count: { id: true } }),
    prisma.lead.groupBy({ by: ['source'], where: leadWhere, _count: { id: true } }),
    prisma.sLABreach.findMany({
      where: { lead: leadWhere, resolvedAt: null },
      include: { lead: { select: { id: true, leadId: true, name: true, stage: true } } },
      orderBy: { breachedAt: 'desc' },
      take: 5,
    }),
    prisma.call.count({
      where: { createdAt: { gte: today }, loggedById: { in: teamUserIds } },
    }),
    prisma.activityLog.count({
      where: { action: 'STAGE_CHANGED', createdAt: { gte: today }, userId: { in: teamUserIds } },
    }),
    prisma.followUpTask.count({
      where: { completedAt: { gte: today }, assignedToId: { in: teamUserIds } },
    }),
    prisma.lead.count({
      where: { ...leadWhere, stage: { notIn: ['INACTIVE', 'ON_HOLD'] } },
    }),
    prisma.lead.count({ where: { ...leadWhere, stage: 'ONBOARDING' } }),
    prisma.meeting.count({
      where: { lead: leadWhere, type: 'PP', status: 'COMPLETED' },
    }),
  ]);

  // ── Stage funnel map ──────────────────────────────────────────────────────────
  const stageMap: Record<string, number> = {};
  for (const row of stageCounts) stageMap[row.stage] = row._count.id;

  const stageFunnel = PIPELINE_STAGES.map((s) => ({ stage: s, count: stageMap[s] ?? 0 }));

  // ── Source breakdown ──────────────────────────────────────────────────────────
  const sourceBreakdown = sourceCounts
    .filter((r) => r.source)
    .map((r) => ({ source: r.source!, count: r._count.id }))
    .sort((a, b) => b.count - a.count);

  // ── Conversion rates (pipeline stage distribution) ────────────────────────────
  const pipelineTotal = PIPELINE_STAGES.reduce((acc, s) => acc + (stageMap[s] ?? 0), 0);

  const conversionRates = {
    elToMql: pipelineTotal > 0
      ? Math.round(((['MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED', 'ONBOARDING']
          .reduce((a, s) => a + (stageMap[s] ?? 0), 0)) / pipelineTotal) * 100)
      : 0,
    mqlToDql: (stageMap['MQL'] ?? 0) + (stageMap['DQL'] ?? 0) > 0
      ? Math.round(((stageMap['DQL'] ?? 0) / ((stageMap['MQL'] ?? 0) + (stageMap['DQL'] ?? 0))) * 100)
      : 0,
    dqlToPp: 0, // requires meeting history — set in personal stats below
    ppToOnboarding: (stageMap['PROPOSAL_PRESENTED'] ?? 0) + (stageMap['ONBOARDING'] ?? 0) > 0
      ? Math.round(((stageMap['ONBOARDING'] ?? 0) /
          ((stageMap['PROPOSAL_PRESENTED'] ?? 0) + (stageMap['ONBOARDING'] ?? 0))) * 100)
      : 0,
  };

  // ── Personal / BL stats ──────────────────────────────────────────────────────
  const personalStats = {
    activeLeads,
    ppDone: ppMeetingsDone,
    onboardings: onboardingLeads,
    targetVsAchieved: { target: null, achieved: onboardingLeads },
  };

  const blStats = user.role === 'BL' ? {
    leadsManaged: totalLeads,
    onboardingCount: onboardingLeads,
    ppCount: ppMeetingsDone,
    teamSize: teamUserIds.length - 1,
  } : null;

  res.json({
    totalLeads,
    leadsToday,
    leadsThisWeek,
    leadsThisMonth,
    stageFunnel,
    sourceBreakdown,
    conversionRates,
    slaBreaches: {
      activeCount: slaBreaches.length,
      list: slaBreaches,
    },
    teamActivity: {
      callsToday,
      stagesMovedToday,
      tasksCompletedToday,
    },
    personalStats,
    blStats,
  });
});
