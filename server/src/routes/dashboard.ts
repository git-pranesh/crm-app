import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { buildLeadRoleWhere } from '../lib/leadScope.js';

export const dashboardRouter = Router();

const PIPELINE_STAGES = [
  'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED',
  'PROPOSAL_DISCUSSION', 'ONBOARDING', 'ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS',
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
  // Shared with GET /api/leads (buildLeadRoleWhere) so dashboard KPI counts
  // and their drill-through list populations never drift apart (task #113).
  const leadWhere: any = await buildLeadRoleWhere(user, prisma);
  let teamUserIds: string[] = [user.id];

  if (user.role === 'DESIGNER' || user.role === 'CRE') {
    teamUserIds = [user.id];
  } else if (user.role === 'BL') {
    const members = await prisma.user.findMany({
      where: { blId: user.id, isActive: true },
      select: { id: true },
    });
    teamUserIds = [user.id, ...members.map((m) => m.id)];
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
    slaBreachTotal,
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
    prisma.lead.groupBy({ by: ['stage'], where: { ...leadWhere, createdAt: { gte: rangeFrom, lte: rangeTo } }, _count: { id: true } }),
    prisma.lead.groupBy({ by: ['source'], where: { ...leadWhere, createdAt: { gte: rangeFrom, lte: rangeTo } }, _count: { id: true } }),
    prisma.sLABreach.findMany({
      // ONBOARDING excluded (task #14): legacy breach rules never covered
      // OB→OBM, so any flag here would be stale/carried over from an earlier
      // stage — that stage is judged solely by the new stage-SLA system.
      // NOTE: `take: 5` below is a display cap for the preview list only —
      // `slaBreachTotal` (separate .count() query) is the real number shown
      // on the KPI tile and must match what /leads?hasUnresolvedSlaBreach=true
      // returns (task #113 — this used to be `slaBreaches.length`, which
      // silently capped the displayed count at 5).
      where: { lead: { ...leadWhere, status: 'ACTIVE', stage: { notIn: ['HANDED_OVER', 'DESIGN_IN_PROGRESS', 'ONBOARDING'] } }, resolvedAt: null },
      include: { lead: { select: { id: true, leadId: true, name: true, stage: true } } },
      orderBy: { breachedAt: 'desc' },
      take: 5,
    }),
    // Distinct-lead count, not a SLABreach-record count — a lead can carry
    // more than one unresolved breach, but /leads?hasUnresolvedSlaBreach=true
    // returns each such lead once, so the KPI must count leads too or the
    // tile and its drill-through disagree (task #113 review).
    prisma.lead.count({
      where: {
        ...leadWhere,
        status: 'ACTIVE',
        stage: { notIn: ['HANDED_OVER', 'DESIGN_IN_PROGRESS', 'ONBOARDING'] },
        slaBreaches: { some: { resolvedAt: null } },
      },
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
      where: { ...leadWhere, status: 'ACTIVE', stage: { notIn: ['HANDED_OVER', 'DESIGN_IN_PROGRESS'] } },
    }),
    // "Won" leads: DESIGN_IN_PROGRESS is the funnel's terminal/incentive stage,
    // HANDED_OVER kept for legacy leads — mirrors performanceRecalc.ts.
    prisma.lead.count({ where: { ...leadWhere, stage: { in: ['DESIGN_IN_PROGRESS', 'HANDED_OVER'] } } }),
    prisma.meeting.count({
      where: { lead: leadWhere, type: 'PP', status: 'COMPLETED' },
    }),
    // pipelineValue: sum of estimatedValue for active pipeline leads
    prisma.lead.aggregate({
      where: {
        ...leadWhere,
        status: 'ACTIVE',
        stage: { notIn: ['HANDED_OVER', 'DESIGN_IN_PROGRESS'] },
        estimatedValue: { not: null },
      },
      _sum: { estimatedValue: true },
    }),
    // NPS responses with scores — filtered by respondedAt so the dashboard period
    // reflects when clients actually rated (not when the survey was sent).
    prisma.nPSResponse.findMany({
      where: {
        lead: leadWhere,
        respondedAt: { not: null, gte: rangeFrom, lte: rangeTo },
        score: { not: null },
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
  // Each rate is "% of leads currently at stage X or later that have already
  // progressed to stage Y or later" — an occupancy-based progression proxy
  // (same approach as before), recomputed for the new 8-stage funnel.
  const rateBetween = (fromStage: string, toStage: string) => {
    const fromIdx = PIPELINE_STAGES.indexOf(fromStage as any);
    const toIdx = PIPELINE_STAGES.indexOf(toStage as any);
    const denom = PIPELINE_STAGES.slice(fromIdx).reduce((a, s) => a + (stageMap[s] ?? 0), 0);
    const numer = PIPELINE_STAGES.slice(toIdx).reduce((a, s) => a + (stageMap[s] ?? 0), 0);
    return denom > 0 ? Math.round((numer / denom) * 100) : 0;
  };
  const conversionRates = {
    mqlToDql: rateBetween('MQL', 'DQL'),
    dqlToPr: rateBetween('DQL', 'PROPOSAL_READY'),
    prToPp: rateBetween('PROPOSAL_READY', 'PROPOSAL_PRESENTED'),
    ppToPd: rateBetween('PROPOSAL_PRESENTED', 'PROPOSAL_DISCUSSION'),
    pdToOb: rateBetween('PROPOSAL_DISCUSSION', 'ONBOARDING'),
    obToObm: rateBetween('ONBOARDING', 'ONBOARDING_MEETING'),
    obmToDip: rateBetween('ONBOARDING_MEETING', 'DESIGN_IN_PROGRESS'),
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

  const stageNpsAvg = (stage: string) => {
    const scores = npsGrouped[stage];
    if (!scores || scores.length === 0) return null;
    return +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  };
  const salesNps = stageNpsAvg('SALE');
  const obNps = stageNpsAvg('ONBOARDING');
  const designFreezeNps = stageNpsAvg('DESIGN_FREEZE');
  const signOffNps = stageNpsAvg('SIGN_OFF');

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

    const attentionWhere = { ...projectWhere, attentionFlags: { some: { resolvedAt: null } } };

    const [inDeliveryAgg, phaseGroups, attentionProjects, attentionTotal, collectionsDue] = await Promise.all([
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
        where: attentionWhere,
        include: {
          lead: { select: { id: true, leadId: true, name: true } },
          attentionFlags: {
            where: { resolvedAt: null },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
        // `take: 20` here is a display cap for the preview list only —
        // `attentionTotal` (separate .count() below) is the real number
        // shown on the KPI tile so it matches /projects?hasAttention=true's
        // total exactly (task #113 — this used to be attentionProjects.length,
        // which silently capped the displayed count at 20).
        take: 20,
      }),
      prisma.project.count({ where: attentionWhere }),
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
      // Real total, not capped by the `take: 20` preview list above — this is
      // what the "Needs Attention" KPI tile displays and must match
      // /projects?dashboardScope=true&hasAttention=true's total exactly.
      needsAttentionTotal: attentionTotal,
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

  // ── Designer-specific extras ──────────────────────────────────────────────────
  let designerDash: any = null;
  if (user.role === 'DESIGNER' || user.role === 'CRE') {
    const now = new Date();
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const tomorrowStart = new Date(now); tomorrowStart.setDate(tomorrowStart.getDate() + 1); tomorrowStart.setHours(0, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setHours(23, 59, 59, 999);
    const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7); weekEnd.setHours(23, 59, 59, 999);
    const nextWeekEnd = new Date(now); nextWeekEnd.setDate(nextWeekEnd.getDate() + 14); nextWeekEnd.setHours(23, 59, 59, 999);

    // Last month range for NPS delta
    const lastMonthStart = new Date(rangeFrom.getFullYear(), rangeFrom.getMonth() - 1, 1);
    const lastMonthEnd = new Date(rangeFrom.getFullYear(), rangeFrom.getMonth(), 0, 23, 59, 59, 999);

    // 6 months ago for trend chart
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Fetch designer's performance record + find peers via blId
    const designerRecord = await prisma.user.findUnique({
      where: { id: user.id },
      select: { blId: true, conversionRate: true, performanceTier: true, avgProjectValue: true },
    });

    const peerUsers: { id: string; name: string }[] = designerRecord?.blId
      ? await prisma.user.findMany({
          where: { blId: designerRecord.blId, isActive: true, role: { in: ['DESIGNER', 'CRE'] } },
          select: { id: true, name: true },
        })
      : [];

    if (!peerUsers.find((p) => p.id === user.id)) {
      peerUsers.push({ id: user.id, name: user.name });
    }
    const peerIds = peerUsers.map((p) => p.id);

    const [
      projectHealthGroups,
      activeProjectsList,
      bookingAchievedAgg,
      poAchievedAgg,
      deadlinesToday,
      deadlinesTomorrow,
      deadlinesThisWeek,
      deadlinesNextWeek,
      npsLastMonthRaw,
      npsTrendRaw,
      recentNotifications,
      peerBookingGroups,
      peerNpsRaw,
      stageFunnelValueGroups,
    ] = await Promise.all([
      // Project health breakdown for active projects
      prisma.project.groupBy({
        by: ['health'],
        where: { designerId: user.id, phase: { notIn: ['HANDOVER', 'COMPLETED'] } },
        _count: { id: true },
      }),

      // Active projects list with health + attention flags (full detail for CRE/DESIGNER panel)
      prisma.project.findMany({
        where: { designerId: user.id, phase: { notIn: ['COMPLETED'] } },
        include: {
          lead: { select: { id: true, leadId: true, name: true } },
          attentionFlags: {
            where: { resolvedAt: null },
            select: { id: true, category: true, description: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),

      // Booking achieved: sum estimatedValue for leads whose first
      // DESIGN_IN_PROGRESS stage transition (per ActivityLog) falls within the
      // selected date range — DIP is the funnel's terminal/incentive stage, so
      // this matches the peer leaderboard and performanceRecalc definition.
      // This avoids the false re-count caused by using lead.updatedAt.
      prisma.lead.aggregate({
        where: {
          ...leadWhere,
          activityLogs: {
            some: {
              action: 'STAGE_CHANGED',
              createdAt: { gte: rangeFrom, lte: rangeTo },
              meta: { path: ['to'], equals: 'DESIGN_IN_PROGRESS' },
            },
          },
          estimatedValue: { not: null },
          // Defense-in-depth (task #89): the ONBOARDING_MEETING->DESIGN_IN_PROGRESS
          // stage-gate (config/stageRequirements.ts) already refuses the
          // transition until the DIP checklist is completed, so a lead cannot
          // reach DIP without it. This filter makes that requirement explicit
          // at the incentive query itself, rather than only relying on the
          // gate having run correctly earlier.
          dipChecklist: { completedAt: { not: null } },
        },
        _sum: { estimatedValue: true },
      }),

      // PO achieved: collections collected in range for this designer's projects
      prisma.collection.aggregate({
        where: {
          status: 'COLLECTED',
          collectedAt: { gte: rangeFrom, lte: rangeTo },
          project: { designerId: user.id },
        },
        _sum: { amount: true },
      }),

      // Upcoming deadlines — today (includes overdue). status: 'PENDING'
      // excludes RESCHEDULED/NOT_DONE archive rows, which keep
      // isCompleted:false on their original (now-stale) due date.
      prisma.followUpTask.count({
        where: { assignedToId: user.id, isCompleted: false, status: 'PENDING', dueDate: { lte: todayEnd } },
      }),

      // Deadlines tomorrow
      prisma.followUpTask.count({
        where: { assignedToId: user.id, isCompleted: false, status: 'PENDING', dueDate: { gte: tomorrowStart, lte: tomorrowEnd } },
      }),

      // Deadlines this week (days 2–7)
      prisma.followUpTask.count({
        where: { assignedToId: user.id, isCompleted: false, status: 'PENDING', dueDate: { gt: tomorrowEnd, lte: weekEnd } },
      }),

      // Deadlines next week (days 8–14)
      prisma.followUpTask.count({
        where: { assignedToId: user.id, isCompleted: false, status: 'PENDING', dueDate: { gt: weekEnd, lte: nextWeekEnd } },
      }),

      // NPS last month for delta comparison
      prisma.nPSResponse.findMany({
        where: {
          lead: leadWhere,
          respondedAt: { not: null, gte: lastMonthStart, lte: lastMonthEnd },
          score: { not: null },
        },
        select: { stage: true, score: true },
      }),

      // NPS trend — last 6 months (for chart)
      prisma.nPSResponse.findMany({
        where: {
          lead: leadWhere,
          respondedAt: { not: null, gte: sixMonthsAgo },
          score: { not: null },
        },
        select: { stage: true, score: true, respondedAt: true },
        orderBy: { respondedAt: 'asc' },
      }),

      // Recent notifications for this designer
      prisma.notificationLog.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { lead: { select: { id: true, leadId: true, name: true } } },
      }),

      // Peer booking values grouped by designer (for leaderboard) — mirrors the
      // incentive-trigger stage used in performanceRecalc (DESIGN_IN_PROGRESS,
      // with HANDED_OVER kept for legacy leads).
      prisma.lead.groupBy({
        by: ['assignedDesignerId'],
        where: {
          assignedDesignerId: { in: peerIds },
          // HANDED_OVER is kept unconditionally for legacy leads that predate
          // the DIP checklist model; current-funnel DESIGN_IN_PROGRESS leads
          // must have a completed DIP checklist (task #89 defense-in-depth —
          // see bookingAchievedAgg above for the full rationale).
          OR: [
            { stage: 'DESIGN_IN_PROGRESS', dipChecklist: { completedAt: { not: null } } },
            { stage: 'HANDED_OVER' },
          ],
          updatedAt: { gte: rangeFrom, lte: rangeTo },
          estimatedValue: { not: null },
        },
        _sum: { estimatedValue: true },
      }),

      // Peer NPS data (raw, to compute per-peer avg in JS)
      prisma.nPSResponse.findMany({
        where: {
          lead: { assignedDesignerId: { in: peerIds } },
          respondedAt: { not: null, gte: rangeFrom, lte: rangeTo },
          score: { not: null },
        },
        select: { score: true, lead: { select: { assignedDesignerId: true } } },
      }),

      // Stage funnel value sums (current active leads, not date-filtered)
      prisma.lead.groupBy({
        by: ['stage'],
        where: { ...leadWhere, status: 'ACTIVE', estimatedValue: { not: null } },
        _sum: { estimatedValue: true },
      }),
    ]);

    // ── Compute derived values ────────────────────────────────────────────────

    // Active project counts
    const healthMap: Record<string, number> = {};
    for (const g of projectHealthGroups) healthMap[g.health] = g._count.id;
    const activeProjectsTotal = Object.values(healthMap).reduce((a, b) => a + b, 0);

    // Stage funnel values map
    const stageFunnelValues: Record<string, number> = {};
    for (const g of stageFunnelValueGroups) {
      stageFunnelValues[g.stage] = g._sum.estimatedValue ? Number(g._sum.estimatedValue) : 0;
    }

    // NPS last month per stage helper
    const npsLastMonthGrouped: Record<string, number[]> = {};
    for (const r of npsLastMonthRaw) {
      if (r.score !== null) {
        if (!npsLastMonthGrouped[r.stage]) npsLastMonthGrouped[r.stage] = [];
        npsLastMonthGrouped[r.stage].push(r.score);
      }
    }
    const npsLastMonthAvg = (stage: string) => {
      const scores = npsLastMonthGrouped[stage];
      if (!scores?.length) return null;
      return +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    };

    // NPS trend — group by year-month
    const trendMap: Record<string, Record<string, number[]>> = {};
    for (const r of npsTrendRaw) {
      if (!r.respondedAt || r.score === null) continue;
      const ym = `${r.respondedAt.getFullYear()}-${String(r.respondedAt.getMonth() + 1).padStart(2, '0')}`;
      if (!trendMap[ym]) trendMap[ym] = {};
      if (!trendMap[ym][r.stage]) trendMap[ym][r.stage] = [];
      trendMap[ym][r.stage].push(r.score);
    }
    // Build 6-month series (last 6 months including current)
    const trendMonths: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      trendMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const monthLabel = (ym: string) => {
      const [y, m] = ym.split('-');
      return new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-IN', { month: 'short', year: '2-digit' });
    };
    const avgArr = (arr: number[] | undefined) => arr?.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;
    const npsTrend = trendMonths.map((ym) => ({
      month: monthLabel(ym),
      SALE: avgArr(trendMap[ym]?.['SALE']),
      DESIGN_FREEZE: avgArr(trendMap[ym]?.['DESIGN_FREEZE']),
      SIGN_OFF: avgArr(trendMap[ym]?.['SIGN_OFF']),
    }));

    // Design progress — project phase groups from active projects list
    const DESIGN_PHASE_LABELS: Record<string, string> = {
      DESIGN: 'Design Development',
      TECHNICAL: 'Technical',
      PRODUCTION: 'Production',
      SITE_EXECUTION: 'Site Execution',
      HANDOVER: 'Handover',
      COMPLETED: 'Completed',
    };
    const phaseCountMap: Record<string, number> = {};
    for (const p of activeProjectsList) {
      phaseCountMap[p.phase] = (phaseCountMap[p.phase] ?? 0) + 1;
    }
    const designProgress = Object.entries(DESIGN_PHASE_LABELS).map(([phase, label]) => ({
      phase, label, count: phaseCountMap[phase] ?? 0,
    }));

    // Client health per project
    const clientHealth = activeProjectsList.map((p) => ({
      projectId: p.id,
      projectCode: p.projectCode,
      clientName: p.lead.name,
      leadId: p.lead.leadId,
      leadDbId: p.lead.id,
      health: p.health,
      attentionCount: p.attentionFlags.length,
    }));

    // Leaderboard — compute per peer
    const peerBookingMap: Record<string, number> = {};
    for (const g of peerBookingGroups) {
      if (g.assignedDesignerId) peerBookingMap[g.assignedDesignerId] = Number(g._sum.estimatedValue ?? 0);
    }
    const peerNpsMap: Record<string, number[]> = {};
    for (const r of peerNpsRaw) {
      const did = r.lead?.assignedDesignerId;
      if (did && r.score !== null) {
        if (!peerNpsMap[did]) peerNpsMap[did] = [];
        peerNpsMap[did].push(r.score);
      }
    }
    const leaderboard = peerUsers
      .map((peer) => ({
        userId: peer.id,
        name: peer.name,
        bookingValue: peerBookingMap[peer.id] ?? 0,
        npsAvg: avgArr(peerNpsMap[peer.id]),
        isCurrentUser: peer.id === user.id,
      }))
      .sort((a, b) => b.bookingValue - a.bookingValue)
      .map((peer, idx) => ({ ...peer, rank: idx + 1 }));

    // Forecast — linear projection from days elapsed in the month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysElapsed = Math.max(now.getDate(), 1);
    const projFactor = daysInMonth / daysElapsed;
    const bookingAchieved = bookingAchievedAgg._sum.estimatedValue ? Number(bookingAchievedAgg._sum.estimatedValue) : 0;
    const poAchieved = Number(poAchievedAgg._sum.amount ?? 0);

    // Incentive estimate (placeholder — no incentive model in schema; derived from tier)
    const tierRates: Record<string, number> = { BASIC: 0.01, STANDARD: 0.015, PREMIUM: 0.02 };
    const tierRate = tierRates[designerRecord?.performanceTier ?? 'BASIC'] ?? 0.01;
    const coreCreditsEarned = Math.floor(bookingAchieved / 100000);
    const nextMilestoneCredits = (Math.floor(coreCreditsEarned / 5) + 1) * 5;
    const nextMilestoneBooking = nextMilestoneCredits * 100000;
    const incentiveEarned = Math.round(bookingAchieved * tierRate);
    const incentiveForecast = Math.round(incentiveEarned * projFactor);

    const bookingForecast = Math.round(bookingAchieved * projFactor);
    const poForecast = Math.round(poAchieved * projFactor);
    const npsForecast = avgNPS;

    // Performance score placeholder (based on tier + conversionRate)
    const tierScoreBase: Record<string, number> = { BASIC: 45, STANDARD: 65, PREMIUM: 82 };
    const perfBase = tierScoreBase[designerRecord?.performanceTier ?? 'BASIC'] ?? 45;
    const perfScore = Math.min(Math.round(perfBase + (designerRecord?.conversionRate ?? 0) * 20), 98);
    const perfCategories = [
      { name: 'Sales', score: Math.min(Math.round(perfBase + 5), 95), weight: 25 },
      { name: 'Design Performance', score: Math.min(Math.round(perfBase - 3), 95), weight: 25 },
      { name: 'Client Satisfaction', score: avgNPS != null ? Math.round(avgNPS * 10) : perfBase, weight: 25 },
      { name: 'Timeline Adherence', score: Math.min(Math.round(perfBase + 2), 95), weight: 25 },
    ];

    designerDash = {
      activeProjects: {
        total: activeProjectsTotal,
        onTrack: healthMap['ON_TRACK'] ?? 0,
        atRisk: healthMap['AT_RISK'] ?? 0,
        delayed: healthMap['DELAYED'] ?? 0,
      },
      bookingAchieved,
      bookingTarget: null,
      poAchieved,
      poTarget: null,
      incentive: {
        walletBalance: incentiveEarned,
        projectedEarnings: incentiveForecast,
        coreCreditsEarned,
        coreCreditsTotal: nextMilestoneCredits,
        boosterCredits: Math.max(0, coreCreditsEarned - 2),
        totalCredits: coreCreditsEarned + Math.max(0, coreCreditsEarned - 2),
        tier: designerRecord?.performanceTier ?? 'BASIC',
        nextMilestoneCredits: nextMilestoneCredits - coreCreditsEarned,
        nextMilestoneBooking: Math.max(0, nextMilestoneBooking - bookingAchieved),
        furnitureIncentive: Math.round(bookingAchieved * 0.002),
        portfolioIncentive: coreCreditsEarned >= 5 ? 5000 : 0,
        potentialEarnings: incentiveForecast + Math.round(bookingAchieved * 0.002),
      },
      npsThisMonth: {
        SALE: salesNps,
        ONBOARDING: obNps,
        DESIGN_FREEZE: designFreezeNps,
        SIGN_OFF: signOffNps,
      },
      npsLastMonth: {
        SALE: npsLastMonthAvg('SALE'),
        ONBOARDING: npsLastMonthAvg('ONBOARDING'),
        DESIGN_FREEZE: npsLastMonthAvg('DESIGN_FREEZE'),
        SIGN_OFF: npsLastMonthAvg('SIGN_OFF'),
      },
      npsTrend,
      designProgress,
      deadlines: { today: deadlinesToday, tomorrow: deadlinesTomorrow, thisWeek: deadlinesThisWeek, nextWeek: deadlinesNextWeek },
      leaderboard,
      clientHealth,
      // CRE users don't receive deliveryWidgets.needsAttention (that block is
      // skipped for CRE). We derive the equivalent list here so both DESIGNER
      // and CRE roles see real attention data on their dashboard.
      attentionItems: activeProjectsList
        .filter((p) => p.attentionFlags.length > 0)
        .slice(0, 20)
        .map((p) => ({
          projectId: p.id,
          projectCode: p.projectCode,
          clientName: p.lead.name,
          leadId: p.lead.leadId,
          category: p.attentionFlags[0]?.category ?? '',
          description: p.attentionFlags[0]?.description ?? '',
          daysOverdue: p.attentionFlags[0]?.createdAt
            ? Math.floor((Date.now() - p.attentionFlags[0].createdAt.getTime()) / 86400000)
            : 0,
        })),
      forecast: {
        bookingForecast,
        poForecast,
        incentiveForecast,
        npsForecast,
        // Only NPS has a meaningful threshold (8.0); booking/PO/incentive
        // have no stored targets yet, so we omit on-track flags for those.
        npsOnTrack: npsForecast != null && npsForecast >= 8,
      },
      recentNotifications: recentNotifications.map((n) => ({
        id: n.id,
        type: n.type,
        message: n.message,
        leadId: n.leadId,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
        lead: n.lead ? { id: n.lead.id, leadId: n.lead.leadId, name: n.lead.name } : null,
      })),
      stageFunnelValues,
      performanceScore: { overall: perfScore, tier: designerRecord?.performanceTier ?? 'BASIC', categories: perfCategories },
    };
  }

  res.json({
    totalLeads,
    // Always-current count of active leads (status ACTIVE, excluding the
    // terminal DESIGN_IN_PROGRESS/HANDED_OVER stages) — unlike totalLeads,
    // this is NOT scoped to the createdAt date range, so it reflects the
    // real current pipeline even when no new leads were created this period.
    activeLeads,
    leadsToday,
    leadsThisWeek,
    leadsThisMonth,
    pipelineValue,
    avgNPS,
    npsBreakdown: { salesNps, obNps, designFreezeNps, signOffNps },
    collectedThisMonth,
    outstanding,
    stageFunnel,
    sourceBreakdown,
    conversionRates,
    slaBreaches: {
      activeCount: slaBreachTotal,
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
      needsAttentionTotal: deliveryWidgets.needsAttentionTotal,
      collectionsDue: deliveryWidgets.collectionsDue,
      inDelivery: deliveryWidgets.inDelivery,
    }),
    ...(designerDash && { designerDash }),
    dateRange: { from: rangeFrom.toISOString(), to: rangeTo.toISOString() },
  });
});
