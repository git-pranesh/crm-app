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
function endOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

dashboardRouter.get('/', verifyToken, async (req, res) => {
  const user = req.user!;
  const { from, to } = req.query as { from?: string; to?: string };

  // ── Date range (default = current month) ─────────────────────────────────
  const rangeFrom = from ? new Date(from) : startOfMonth();
  const rangeTo = to ? (() => { const d = new Date(to); d.setHours(23, 59, 59, 999); return d; })() : endOfMonth();

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
    pipelineValueRaw,
    npsResponses,
    collectionsThisMonth,
    outstandingProjects,
  ] = await Promise.all([
    prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: rangeFrom, lte: rangeTo } } }),
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
      where: { ...leadWhere, stage: { notIn: ['INACTIVE', 'ON_HOLD', 'HANDED_OVER'] } },
    }),
    prisma.lead.count({ where: { ...leadWhere, stage: 'ONBOARDING' } }),
    prisma.meeting.count({
      where: { lead: leadWhere, type: 'PP', status: 'COMPLETED' },
    }),
    // pipelineValue: sum of estimatedValue for active pipeline leads
    prisma.lead.aggregate({
      where: {
        ...leadWhere,
        stage: { notIn: ['INACTIVE', 'ON_HOLD', 'HANDED_OVER'] },
        estimatedValue: { not: null },
      },
      _sum: { estimatedValue: true },
    }),
    // NPS responses with scores (for avgNPS)
    prisma.nPSResponse.findMany({
      where: {
        lead: leadWhere,
        respondedAt: { not: null },
        score: { not: null },
        sentAt: { gte: rangeFrom, lte: rangeTo },
      },
      select: { stage: true, score: true },
    }),
    // Collections collected this month
    prisma.collection.aggregate({
      where: {
        status: 'COLLECTED',
        collectedAt: { gte: startOfMonth(), lte: endOfMonth() },
        project: { ...(Object.keys(leadWhere).length > 0 ? { lead: leadWhere } : {}) },
      },
      _sum: { amount: true },
    }),
    // Outstanding amount across active projects
    prisma.project.aggregate({
      where: {
        phase: { notIn: ['HANDOVER', 'COMPLETED'] },
        ...(Object.keys(leadWhere).length > 0 ? { lead: leadWhere } : {}),
      },
      _sum: { outstandingAmount: true },
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

  // ── Conversion rates ──────────────────────────────────────────────────────────
  const pipelineTotal = PIPELINE_STAGES.reduce((acc, s) => acc + (stageMap[s] ?? 0), 0);
  const conversionRates = {
    elToMql: pipelineTotal > 0
      ? Math.round(((['MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED', 'ONBOARDING']
          .reduce((a, s) => a + (stageMap[s] ?? 0), 0)) / pipelineTotal) * 100)
      : 0,
    mqlToDql: (stageMap['MQL'] ?? 0) + (stageMap['DQL'] ?? 0) > 0
      ? Math.round(((stageMap['DQL'] ?? 0) / ((stageMap['MQL'] ?? 0) + (stageMap['DQL'] ?? 0))) * 100)
      : 0,
    dqlToPp: 0,
    ppToOnboarding: (stageMap['PROPOSAL_PRESENTED'] ?? 0) + (stageMap['ONBOARDING'] ?? 0) > 0
      ? Math.round(((stageMap['ONBOARDING'] ?? 0) /
          ((stageMap['PROPOSAL_PRESENTED'] ?? 0) + (stageMap['ONBOARDING'] ?? 0))) * 100)
      : 0,
  };

  // ── avgNPS: average of per-stage averages ────────────────────────────────────
  const npsGrouped: Record<string, number[]> = {};
  for (const r of npsResponses) {
    if (r.score !== null) {
      if (!npsGrouped[r.stage]) npsGrouped[r.stage] = [];
      npsGrouped[r.stage].push(r.score);
    }
  }
  const stageAverages = Object.values(npsGrouped).map(
    (scores) => scores.reduce((a, b) => a + b, 0) / scores.length,
  );
  const avgNPS = stageAverages.length > 0
    ? +(stageAverages.reduce((a, b) => a + b, 0) / stageAverages.length).toFixed(1)
    : null;

  // ── Pipeline value ────────────────────────────────────────────────────────────
  const pipelineValue = pipelineValueRaw._sum.estimatedValue
    ? Number(pipelineValueRaw._sum.estimatedValue)
    : 0;

  // ── Financial ────────────────────────────────────────────────────────────────
  const collectedThisMonth = collectionsThisMonth._sum.amount ?? 0;
  const outstanding = outstandingProjects._sum.outstandingAmount ?? 0;

  // ── Projects delivery widgets ─────────────────────────────────────────────────
  let deliveryWidgets: any = null;
  if (user.role !== 'CRE') {
    const projectWhere: any = Object.keys(leadWhere).length > 0 ? { lead: leadWhere } : {};

    const [inDeliveryAgg, phaseGroups, attentionProjects, collectionsDue] = await Promise.all([
      prisma.project.aggregate({
        where: { ...projectWhere, phase: { notIn: ['HANDOVER', 'COMPLETED'] } },
        _count: { id: true },
        _sum: { contractValue: true },
      }),
      prisma.project.groupBy({
        by: ['phase'],
        where: projectWhere,
        _count: { id: true },
        _sum: { contractValue: true },
      }),
      prisma.project.findMany({
        where: {
          ...projectWhere,
          attentionFlags: { some: { resolvedAt: null } },
        },
        include: {
          lead: { select: { id: true, leadId: true, name: true } },
          attentionFlags: {
            where: { resolvedAt: null },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
        take: 20,
      }),
      prisma.collection.findMany({
        where: {
          status: { not: 'COLLECTED' },
          project: projectWhere,
        },
        include: {
          project: {
            include: { lead: { select: { id: true, leadId: true, name: true } } },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
    ]);

    const now = Date.now();

    deliveryWidgets = {
      inDelivery: {
        count: inDeliveryAgg._count.id,
        contractValueSum: inDeliveryAgg._sum.contractValue ?? 0,
      },
      phaseLoad: phaseGroups.map((g) => ({
        phase: g.phase,
        count: g._count.id,
        valueSum: g._sum.contractValue ?? 0,
      })),
      needsAttention: attentionProjects.map((p) => ({
        projectId: p.id,
        projectCode: p.projectCode,
        clientName: p.lead.name,
        leadId: p.lead.leadId,
        category: p.attentionFlags[0]?.category ?? '',
        description: p.attentionFlags[0]?.description ?? '',
        daysOverdue: p.attentionFlags[0]
          ? Math.floor((now - p.attentionFlags[0].createdAt.getTime()) / 86400000)
          : 0,
      })),
      collectionsDue: collectionsDue.map((c) => ({
        collectionId: c.id,
        projectId: c.projectId,
        projectCode: c.project.projectCode,
        clientName: c.project.lead.name,
        leadId: c.project.lead.leadId,
        milestone: c.milestone,
        amount: c.amount,
        status: c.status,
        dueDate: c.dueDate,
        daysWaiting: c.dueDate
          ? Math.floor((now - c.dueDate.getTime()) / 86400000)
          : null,
      })),
    };
  }

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
    pipelineValue,
    avgNPS,
    collectedThisMonth,
    outstanding,
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
    ...(deliveryWidgets && {
      phaseLoad: deliveryWidgets.phaseLoad,
      needsAttention: deliveryWidgets.needsAttention,
      collectionsDue: deliveryWidgets.collectionsDue,
      inDelivery: deliveryWidgets.inDelivery,
    }),
    dateRange: { from: rangeFrom.toISOString(), to: rangeTo.toISOString() },
  });
});
