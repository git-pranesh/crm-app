import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';
import { sendEmail, stageMoveBackwardEmail, intentRatingChangedEmail } from '../lib/email.js';
import { createAndSendNps } from '../lib/npsHelper.js';
import { selectBLForLead, assignLeadToDesigner, incrementAssigned } from '../services/assignmentService.js';
import { checkStageRequirements, isStageJumpAllowed, FUNNEL_ORDER } from '../config/stageRequirements.js';
import { computeSystemRating } from '../services/intentScoring.js';
import { isAuthorizedForLead } from '../lib/leadAuth.js';
import { isValidEmail, isValidPhone } from '../lib/leadValidation.js';
import { computeSlaInfoForLeads, computeSlaInfoForLead, getEffectiveStageSla } from '../lib/stageSla.js';
import { putLeadOnHold, markLeadInactive, reactivateLead } from '../lib/leadStatusActions.js';
import { buildLeadRoleWhere } from '../lib/leadScope.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const leadsRouter = Router();

// ── Auto-generate X#### lead ID ───────────────────────────────────────────────
async function generateLeadId(): Promise<string> {
  const counter = await prisma.$transaction(async (tx) => {
    return tx.leadCounter.upsert({
      where: { id: 1 },
      create: { id: 1, lastNum: 1 },
      update: { lastNum: { increment: 1 } },
    });
  });
  return `X${String(counter.lastNum).padStart(4, '0')}`;
}

const LEAD_INCLUDE = {
  assignedDesigner: { select: { id: true, name: true, role: true } },
  assignedBL: { select: { id: true, name: true } },
  currentOffer: { select: { id: true, name: true } },
  _count: { select: { calls: true, meetings: true, followUpTasks: true } },
  followUpTasks: {
    // status: 'PENDING' excludes RESCHEDULED/NOT_DONE archive rows — those
    // are terminal and must never surface as an "overdue" badge on the lead.
    where: { isOverdue: true, isCompleted: false, status: 'PENDING' },
    select: { id: true },
    take: 1,
  },
} as const;

// ── GET /api/leads — list with filters + pagination ───────────────────────────
leadsRouter.get('/', verifyToken, async (req, res) => {
  try {
    const {
      stage, source, designerId, blId, search,
      isSLABreached, page = '1', limit = '50',
      projectType, location, dateRange, intent,
      status,
      // New pipeline filters (task #27)
      originDateFrom, originDateTo,
      budgetMin, budgetMax,
      possessionDateFrom, possessionDateTo,
      projectedObFrom, projectedObTo,
      pipelineMode,
      // Task #113 — lets dashboard KPI drill-through links exactly reproduce
      // a stage-excluding count (e.g. "active leads" excludes the terminal
      // DESIGN_IN_PROGRESS/HANDED_OVER stages) without a separate endpoint.
      excludeStages,
      hasUnresolvedSlaBreach,
    } = req.query as Record<string, string>;

    const user = req.user!;
    const where: any = {};

    // Role-scope — shared with the dashboard (buildLeadRoleWhere) so the two
    // never drift apart and KPI drill-through counts stay exact.
    const roleWhere = await buildLeadRoleWhere(user, prisma);
    if (Object.keys(roleWhere).length > 0) where.AND = [roleWhere];

    // Task #88: status (ACTIVE/ON_HOLD/INACTIVE) is a real field, independent
    // of stage — both filters can be applied together.
    if (stage) where.stage = stage;
    if (excludeStages) where.stage = { ...(where.stage ?? {}), notIn: excludeStages.split(',').map((s) => s.trim()).filter(Boolean) };
    if (status) where.status = status;
    if (source) where.source = source;
    if (designerId) where.assignedDesignerId = designerId;
    if (blId) where.assignedBLId = blId;
    // ONBOARDING excluded (task #14) — the legacy flag is display-suppressed
    // for that stage below, so it must also be excluded from this filter to
    // avoid a lead appearing in "SLA breached" results while showing
    // isSLABreached:false on its own record.
    if (isSLABreached === 'true') {
      where.isSLABreached = true;
      if (!where.stage) where.stage = { not: 'ONBOARDING' };
    }
    // Task #113 — exact match for the dashboard's "Needs Attention" SLA count,
    // which queries unresolved SLABreach records (not the legacy isSLABreached
    // flag) on active, non-terminal, non-onboarding leads.
    if (hasUnresolvedSlaBreach === 'true') {
      where.status = 'ACTIVE';
      where.stage = { ...(where.stage ?? {}), notIn: ['HANDED_OVER', 'DESIGN_IN_PROGRESS', 'ONBOARDING'] };
      where.slaBreaches = { some: { resolvedAt: null } };
    }
    // G2: new filter params
    if (projectType) where.projectType = projectType;
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (intent) where.intentRating = parseInt(intent);
    if (dateRange) {
      const [from, to] = (dateRange as string).split(',');
      where.createdAt = { gte: new Date(from), lte: new Date(to) };
    }
    if (search) {
      // Use AND so we never overwrite an existing where.OR set by role scoping
      // (e.g. CRE has where.OR = [assignedDesignerId, createdById]).
      // Appending to AND means: (role_scope) AND (name|phone|leadId|email match).
      const searchOr = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { leadId: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: searchOr }];
    }

    // ── Task #27 new pipeline filters ────────────────────────────────────────
    // pipelineMode: hide EFFECTIVE_LEAD for designer/CRE views when no explicit
    // stage filter is already applied.
    if (
      pipelineMode === '1' &&
      (user.role === 'DESIGNER' || user.role === 'CRE') &&
      !stage && !status
    ) {
      where.stage = { not: 'EFFECTIVE_LEAD' as any };
    }

    // Origin date range.
    if (originDateFrom || originDateTo) {
      const existingCat = where.createdAt ?? {};
      if (originDateFrom) (existingCat as any).gte = new Date(originDateFrom);
      if (originDateTo) {
        // include full end day
        const end = new Date(originDateTo);
        end.setHours(23, 59, 59, 999);
        (existingCat as any).lte = end;
      }
      where.createdAt = existingCat;
    }

    // Budget / estimated value range.
    if (budgetMin || budgetMax) {
      const ev: any = {};
      if (budgetMin) {
        const n = parseFloat(budgetMin);
        if (!isNaN(n)) ev.gte = n;
      }
      if (budgetMax) {
        const n = parseFloat(budgetMax);
        if (!isNaN(n)) ev.lte = n;
      }
      where.estimatedValue = ev;
    }

    // Possession / expected move-in date range.
    if (possessionDateFrom || possessionDateTo) {
      const em: any = {};
      if (possessionDateFrom) em.gte = new Date(possessionDateFrom);
      if (possessionDateTo) {
        const end = new Date(possessionDateTo);
        end.setHours(23, 59, 59, 999);
        em.lte = end;
      }
      where.expectedMoveIn = em;
    }

    // Projected OB date range — Task #83 added a dedicated expectedObDate
    // column (Founder spec item 4: PR→PP gate field, also filterable here).
    if (projectedObFrom || projectedObTo) {
      const pb: any = {};
      if (projectedObFrom) pb.gte = new Date(projectedObFrom);
      if (projectedObTo) {
        const end = new Date(projectedObTo);
        end.setHours(23, 59, 59, 999);
        pb.lte = end;
      }
      where.expectedObDate = pb;
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: LEAD_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.lead.count({ where }),
    ]);

    // Batch-fetch NPS averages for this page of leads
    const leadIds = leads.map((l: any) => l.id);
    let npsAvgMap: Record<string, number | null> = {};
    if (leadIds.length > 0) {
      const npsData = await prisma.nPSResponse.findMany({
        where: { leadId: { in: leadIds }, score: { not: null } },
        select: { leadId: true, score: true },
      });
      const npsScores = new Map<string, number[]>();
      for (const n of npsData) {
        if (!npsScores.has(n.leadId)) npsScores.set(n.leadId, []);
        npsScores.get(n.leadId)!.push(n.score!);
      }
      for (const [lId, scores] of npsScores) {
        npsAvgMap[lId] = +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
      }
    }

    // Augment each lead with isUnread flag — only meaningful for the assigned designer.
    // Other roles (BL, CRE, Branch Head) always receive isUnread:false so the badge
    // never appears for users who cannot clear it.
    const viewerIsDesigner = user.role === 'DESIGNER';
    // SLA breach indicators (task #56) — days stuck in current stage + status
    const slaInfoMap = await computeSlaInfoForLeads(leads);
    const leadsWithMeta = leads.map((l: any) => ({
      ...l,
      avgNps: npsAvgMap[l.id] ?? null,
      isUnread: viewerIsDesigner && l.assignedDesignerId === user.id && !l.firstOpenedAt,
      daysInCurrentStage: slaInfoMap[l.id]?.daysInCurrentStage ?? 0,
      slaStatus: slaInfoMap[l.id]?.slaStatus ?? 'ok',
      // Task #14: a lead in ONBOARDING is only "breached" per the new
      // stage-SLA system (slaStatus, above) — never via a legacy flag left
      // over from an earlier stage's rule.
      isSLABreached: l.stage === 'ONBOARDING' ? false : l.isSLABreached,
    }));

    res.json({ leads: leadsWithMeta, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
  } catch (err: any) {
    console.error('[leads:list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/meta/status-summary — counts + value by status (task #88) ──
// Overall and per-stage breakdown, scoped by the same role rules as the list
// endpoint, so dashboards/lists can show "12 Active / 3 On Hold / 1 Inactive"
// (and per-stage) without pulling every lead down to the client to tally.
leadsRouter.get('/meta/status-summary', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const where: any = {};
    if (user.role === 'DESIGNER') {
      where.assignedDesignerId = user.id;
    } else if (user.role === 'CRE') {
      where.OR = [{ assignedDesignerId: user.id }, { createdById: user.id }];
    } else if (user.role === 'BL') {
      const members = await prisma.user.findMany({ where: { blId: user.id, isActive: true }, select: { id: true } });
      where.AND = [{ OR: [{ assignedDesignerId: { in: [user.id, ...members.map((m) => m.id)] } }, { assignedBLId: user.id }] }];
    }

    const groups = await prisma.lead.groupBy({
      by: ['status', 'stage'],
      where,
      _count: { id: true },
      _sum: { estimatedValue: true },
    });

    const overall: Record<string, { count: number; value: number }> = {
      ACTIVE: { count: 0, value: 0 }, ON_HOLD: { count: 0, value: 0 }, INACTIVE: { count: 0, value: 0 },
    };
    const perStage: Record<string, Record<string, { count: number; value: number }>> = {};

    for (const g of groups) {
      const count = g._count.id;
      const value = g._sum.estimatedValue ? Number(g._sum.estimatedValue) : 0;
      overall[g.status].count += count;
      overall[g.status].value += value;
      if (!perStage[g.stage]) {
        perStage[g.stage] = { ACTIVE: { count: 0, value: 0 }, ON_HOLD: { count: 0, value: 0 }, INACTIVE: { count: 0, value: 0 } };
      }
      perStage[g.stage][g.status] = { count, value };
    }

    res.json({ overall, perStage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads — create lead ─────────────────────────────────────────────
leadsRouter.post('/', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const {
      name, phone, phone2, email, source, adName,
      utmCampaign, utmAdSet, utmSource,
      projectType, scope, location, possessionTimeline,
      estimatedValue, intentRating,
      assignedDesignerId, assignedBLId,
    } = req.body as Record<string, string>;

    // Every field is mandatory to create a lead except email and estimatedValue
    // (client budget) — this must mirror the client-side required-field rules
    // in Layout.tsx's New Lead modal, not just be enforced in the UI.
    if (!name?.trim() || !phone?.trim() || !projectType?.trim() || !scope?.trim() || !location?.trim() || !possessionTimeline?.trim() || !source?.trim()) {
      res.status(400).json({ error: 'name, phone, projectType, scope, location, possessionTimeline and source are required' });
      return;
    }
    if (!isValidPhone(phone)) {
      res.status(400).json({ error: 'phone: must be 7–15 digits' });
      return;
    }
    if (email?.trim() && !isValidEmail(email)) {
      res.status(400).json({ error: 'email: invalid format' });
      return;
    }
    if (phone2?.trim() && !isValidPhone(phone2)) {
      res.status(400).json({ error: 'phone2: must be 7–15 digits' });
      return;
    }

    // Check duplicate phone
    const existing = await prisma.lead.findFirst({ where: { phone } });
    if (existing) {
      res.status(409).json({ isDuplicate: true, error: 'A lead with this phone number already exists', existingLeadId: existing.leadId });
      return;
    }

    // Check duplicate email
    if (email?.trim()) {
      const emailExisting = await prisma.lead.findFirst({ where: { email: email.trim() } });
      if (emailExisting) {
        res.status(409).json({ isDuplicate: true, error: 'A lead with this email already exists', existingLeadId: emailExisting.leadId });
        return;
      }
    }

    const leadId = await generateLeadId();

    // Task #77 — a CRE (or designer) with no BL of their own yet still needs
    // this lead to reach a Business Lead, so fall back to round robin rather
    // than leaving it unassigned. (The G5 auto-assign-on-transition trigger
    // in PATCH /:id never fires for leads born already at MQL, so this
    // create path needs its own resolution.)
    let resolvedBLId = assignedBLId || (user.role === 'BL' ? user.id : (['CRE', 'DESIGNER'].includes(user.role) ? user.blId ?? undefined : undefined));
    if (!resolvedBLId && ['CRE', 'DESIGNER'].includes(user.role)) {
      const bl = await selectBLForLead();
      if (bl) resolvedBLId = bl.id;
    }

    const lead = await prisma.lead.create({
      data: {
        leadId,
        name: name.trim(),
        phone: phone.trim(),
        phone2: phone2?.trim() || undefined,
        email: email?.trim() || undefined,
        source: source?.trim() || undefined,
        adName: adName?.trim() || undefined,
        utmCampaign: utmCampaign?.trim() || undefined,
        utmAdSet: utmAdSet?.trim() || undefined,
        utmSource: utmSource?.trim() || undefined,
        projectType: projectType?.trim() || undefined,
        scope: scope?.trim() || undefined,
        location: location?.trim() || undefined,
        possessionTimeline: possessionTimeline?.trim() || undefined,
        estimatedValue: estimatedValue ? parseFloat(estimatedValue) : undefined,
        intentRating: intentRating ? parseInt(intentRating) : undefined,
        // Auto-assign to creator based on role
        assignedDesignerId: assignedDesignerId || (['CRE', 'DESIGNER'].includes(user.role) ? user.id : undefined),
        assignedBLId: resolvedBLId,
        createdById: user.id,
        stage: 'MQL',
      },
      include: LEAD_INCLUDE,
    });

    await logActivity(user.id, 'LEAD_CREATED', lead.id, { leadId, source });

    res.status(201).json({ lead });
  } catch (err: any) {
    console.error('[leads:create]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/manual — create lead manually (CRE / BL / BRANCH_HEAD) ────
// projectType/scope/location are intentionally NOT required here — this route
// is for fast walk-in/referral capture where those details aren't known yet
// and get filled in later, unlike the primary `/leads` create form which
// collects them upfront. Phone/email format is still enforced below.
leadsRouter.post(
  '/manual',
  verifyToken,
  requireRole('CRE', 'BL', 'BRANCH_HEAD'),
  async (req, res) => {
    try {
      const user = req.user!;
      const { name, phone, phone2, email, source, designerId } = req.body as {
        name?: string;
        phone?: string;
        phone2?: string;
        email?: string;
        source?: string;
        designerId?: string;
      };

      if (!name?.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      if (!phone?.trim()) {
        res.status(400).json({ error: 'phone is required' });
        return;
      }
      if (!isValidPhone(phone)) {
        res.status(400).json({ error: 'phone: must be 7–15 digits' });
        return;
      }
      if (phone2?.trim() && !isValidPhone(phone2)) {
        res.status(400).json({ error: 'phone2: must be 7–15 digits' });
        return;
      }
      if (email?.trim() && !isValidEmail(email)) {
        res.status(400).json({ error: 'email: invalid format' });
        return;
      }

      const ALLOWED_SOURCES = ['Walk-in', 'Referral', 'Manual'] as const;
      if (!source || !(ALLOWED_SOURCES as readonly string[]).includes(source)) {
        res.status(400).json({ error: `source must be one of: ${ALLOWED_SOURCES.join(' | ')}` });
        return;
      }

      // Duplicate check — phone
      const phoneMatch = await prisma.lead.findFirst({ where: { phone: phone.trim() } });
      if (phoneMatch) {
        res.status(409).json({
          isDuplicate: true,
          error: 'A lead with this phone number already exists',
          existingLeadId: phoneMatch.leadId,
          warning: `Phone ${phone.trim()} is already registered as lead ${phoneMatch.leadId}`,
        });
        return;
      }

      // Duplicate check — email (if provided)
      if (email?.trim()) {
        const emailMatch = await prisma.lead.findFirst({ where: { email: email.trim() } });
        if (emailMatch) {
          res.status(409).json({
            isDuplicate: true,
            error: 'A lead with this email already exists',
            existingLeadId: emailMatch.leadId,
            warning: `Email ${email.trim()} is already registered as lead ${emailMatch.leadId}`,
          });
          return;
        }
      }

      // Assignment logic
      let assignedDesignerId: string | undefined;
      let assignedBLId: string | undefined;

      if (user.role === 'CRE') {
        assignedDesignerId = user.id;
        // Task #77 — a CRE creating a lead directly (not via the ad-webhook
        // qualification queue) has already qualified it, so it should get a
        // round-robin BL immediately rather than sitting unassigned forever.
        // (The G5 auto-assign-on-transition trigger in PATCH /:id never fires
        // for leads born already at a stage, so this path needs its own call.)
        const bl = await selectBLForLead();
        if (bl) assignedBLId = bl.id;
      } else if (user.role === 'BL') {
        assignedBLId = user.id;
        if (designerId) {
          const designer = await prisma.user.findUnique({
            where: { id: designerId },
            select: { id: true, blId: true },
          });
          if (!designer) { res.status(404).json({ error: 'Designer not found' }); return; }
          if (designer.blId !== user.id) {
            res.status(403).json({ error: 'Designer is not on your team' });
            return;
          }
          assignedDesignerId = designerId;
        }
      } else if (user.role === 'BRANCH_HEAD' && designerId) {
        const designer = await prisma.user.findUnique({
          where: { id: designerId },
          select: { id: true, blId: true },
        });
        if (!designer) { res.status(404).json({ error: 'Designer not found' }); return; }
        assignedDesignerId = designerId;
        if (designer.blId) assignedBLId = designer.blId;
      }

      const leadId = await generateLeadId();

      const lead = await prisma.lead.create({
        data: {
          leadId,
          name: name.trim(),
          phone: phone.trim(),
          ...(phone2?.trim() && { phone2: phone2.trim() }),
          ...(email?.trim() && { email: email.trim() }),
          source,
          stage: 'MQL',
          assignmentPath: 'DIRECT',
          createdById: user.id,
          ...(assignedDesignerId && { assignedDesignerId }),
          ...(assignedBLId && { assignedBLId }),
        },
        include: LEAD_INCLUDE,
      });

      await logActivity(user.id, 'LEAD_CREATED_MANUAL', lead.id, {
        leadId,
        source,
        createdByRole: user.role,
        ...(assignedDesignerId && { assignedDesignerId }),
      });

      res.status(201).json({ lead });
    } catch (err: any) {
      console.error('[leads:manual]', err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /api/leads/meta/designers — designers filterable in this user's scope ─
leadsRouter.get('/meta/designers', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    let where: any = { role: 'DESIGNER', isActive: true };
    if (user.role === 'BL') {
      where = { role: 'DESIGNER', isActive: true, blId: user.id };
    } else if (user.role === 'DESIGNER') {
      where = { role: 'DESIGNER', isActive: true, id: user.id };
    }
    const designers = await prisma.user.findMany({ where, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    res.json({ designers });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load designers' });
  }
});

// ── GET /api/leads/export — download filtered leads as CSV (or, with
// ?format=xlsx, Excel — task #90 made the Excel option admin-only) ───────────
leadsRouter.get('/export', verifyToken, async (req, res) => {
  try {
    const {
      stage, source, designerId, blId, search,
      projectType, location, dateRange, intent,
      status, format,
    } = req.query as Record<string, string>;

    const user = req.user!;

    // Excel export is admin-only (task #90); CSV keeps its existing scoped access.
    if (format === 'xlsx' && user.role !== 'BRANCH_HEAD') {
      res.status(403).json({ error: 'Excel export is only available to Branch Head admins' });
      return;
    }

    const where: any = {};

    // Role scoping (same rules as list)
    if (user.role === 'DESIGNER') {
      where.assignedDesignerId = user.id;
    } else if (user.role === 'BL') {
      const teamMembers = await prisma.user.findMany({
        where: { blId: user.id, isActive: true },
        select: { id: true },
      });
      const teamIds = teamMembers.map((m: any) => m.id);
      where.OR = [{ assignedBLId: user.id }, { assignedDesignerId: { in: teamIds } }];
    }

    if (stage) where.stage = stage;
    if (status) where.status = status;
    if (source) where.source = source;
    if (designerId) where.assignedDesignerId = designerId;
    if (blId) where.assignedBLId = blId;
    if (projectType) where.projectType = projectType;
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (search) {
      // Same AND-wrap as the list handler — never overwrite role-scope OR clauses.
      const searchOr = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { leadId: { contains: search, mode: 'insensitive' } },
      ];
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: searchOr }];
    }
    if (intent) {
      const intentVal = parseInt(intent);
      if (!isNaN(intentVal)) where.intentRating = intentVal;
    }
    if (dateRange) {
      const now = new Date();
      if (dateRange === '7d') where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
      else if (dateRange === '30d') where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
      else if (dateRange === 'thisMonth') {
        where.createdAt = { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
      }
    }

    const leads = await prisma.lead.findMany({
      where,
      include: {
        assignedDesigner: { select: { name: true } },
        assignedBL: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const columns = ['Lead ID', 'Name', 'Phone', 'Email', 'Stage', 'Source', 'Estimated Value', 'Intent Rating', 'Designer', 'BL', 'Created At'];
    const dataRows = leads.map((l: any) => [
      l.leadId,
      l.name ?? '',
      l.phone ?? '',
      l.email ?? '',
      l.stage,
      l.source ?? '',
      l.estimatedValue ?? '',
      l.intentRating ?? '',
      l.assignedDesigner?.name ?? '',
      l.assignedBL?.name ?? '',
      l.createdAt.toISOString(),
    ]);

    if (format === 'xlsx') {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Leads');
      sheet.addRow(columns).font = { bold: true };
      dataRows.forEach((row) => sheet.addRow(row));
      sheet.columns.forEach((col) => { col.width = 18; });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="leads_export_${new Date().toISOString().slice(0, 10)}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    const header = columns.join(',') + '\n';
    const csv = header + dataRows.map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="leads_export_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err: any) {
    console.error('[leads:export]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id — get lead detail ──────────────────────────────────────
leadsRouter.get('/:id', verifyToken, async (req, res) => {
  try {
    const viewer = req.user!;
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        ...LEAD_INCLUDE,
        contacts: true,
        currentOffer: true,
        discountRequests: {
          include: {
            requestedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        slaBreaches: { where: { resolvedAt: null } },
        leadOffers: { include: { offer: { select: { id: true, name: true } } }, orderBy: { appliedAt: 'desc' } },
        emailLogs: { orderBy: { sentAt: 'desc' }, take: 50 },
        smsLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
        project: { select: { id: true, projectCode: true } },
      },
    });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    // Track first open by the assigned designer (fire-and-forget)
    if (
      viewer.role === 'DESIGNER' &&
      lead.assignedDesignerId === viewer.id &&
      !lead.firstOpenedAt
    ) {
      prisma.lead.update({ where: { id: req.params.id }, data: { firstOpenedAt: new Date() } }).catch(() => {});
    }

    // NPS: per-stage scores and average for this lead
    const npsRows = await prisma.nPSResponse.findMany({
      where: { leadId: req.params.id },
      select: { stage: true, score: true, sentAt: true, respondedAt: true },
      orderBy: { sentAt: 'asc' },
    });
    const respondedNps = npsRows.filter((r) => r.score !== null);
    const avgNps = respondedNps.length > 0
      ? +(respondedNps.reduce((acc, r) => acc + r.score!, 0) / respondedNps.length).toFixed(1)
      : null;
    const npsPerStage = npsRows.reduce((acc, r) => ({ ...acc, [r.stage]: r }), {} as Record<string, typeof npsRows[0]>);

    // SLA breach indicator (task #56) — days stuck in current stage + status
    const slaInfo = await computeSlaInfoForLead(lead);
    // Task #14: suppress the legacy breach flag in ONBOARDING — see the
    // matching comment on GET /api/leads for why.
    const isSLABreached = lead.stage === 'ONBOARDING' ? false : lead.isSLABreached;

    res.json({ lead: { ...lead, ...slaInfo, isSLABreached }, avgNps, npsPerStage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id — update lead ───────────────────────────────────────
leadsRouter.patch('/:id', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const {
      name, phone, phone2, email, source,
      stage, projectType, scope, location,
      estimatedValue, intentRating, possessionTimeline,
      nextMeetingDate, floorPlanUrl,
      assignedDesignerId, assignedBLId,
      customFields,
      // Task #20 — new key-facts fields
      builder, offer1, offer2, offer3, expectedMoveIn,
      email2, pan, gst, notes,
      // Task #83 — Expected OB date (PR→PP gate field, also filterable)
      expectedObDate,
    } = req.body as Record<string, any>;

    // ── Format validation ─────────────────────────────────────────────────────
    if (email !== undefined && email?.trim() && !isValidEmail(email)) {
      res.status(400).json({ error: 'email: invalid format' });
      return;
    }
    if (email2 !== undefined && email2?.trim() && !isValidEmail(email2)) {
      res.status(400).json({ error: 'email2: invalid format' });
      return;
    }
    if (phone !== undefined && phone?.trim() && !isValidPhone(phone)) {
      res.status(400).json({ error: 'phone: must be 7–15 digits' });
      return;
    }
    if (phone2 !== undefined && phone2?.trim() && !isValidPhone(phone2)) {
      res.status(400).json({ error: 'phone2: must be 7–15 digits' });
      return;
    }
    // Note: name/phone/projectType/scope/location are required on the primary
    // lead-edit UI (client-side, before submit) but are intentionally NOT
    // hard-blocked here on PATCH — leads created via CSV import or ad
    // webhooks may legitimately lack these fields, and PATCH is also used by
    // internal flows (stage moves, reassignment) that don't touch them. A
    // server-side block here would make those legacy/ingested leads
    // permanently uneditable via any endpoint other than the exact field
    // that's missing. Format validation above still applies to any value
    // that IS supplied.
    //
    // expectedMoveIn / possessionTimeline are the exception: the primary
    // lead-creation forms treat these as mandatory (Task #73), so clearing
    // them back to blank via this same PATCH must be blocked too — otherwise
    // the rule only holds at creation time and silently stops applying the
    // moment someone edits an existing lead.
    if (expectedMoveIn !== undefined && !expectedMoveIn) {
      res.status(400).json({ error: 'Expected Move-in date cannot be cleared — it is a required field.' });
      return;
    }
    if (possessionTimeline !== undefined && !possessionTimeline?.trim()) {
      res.status(400).json({ error: 'Possession cannot be cleared — it is a required field.' });
      return;
    }

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Lead not found' }); return; }

    const prevStage = existing.stage;

    // Task #88: ON_HOLD/INACTIVE are no longer valid `stage` values — they're
    // tracked on the separate `status` field so the real funnel stage is
    // preserved while a lead is parked. Redirect stale callers.
    if (stage === 'ON_HOLD' || stage === 'INACTIVE') {
      res.status(400).json({ error: `Use PATCH /api/leads/:id/status to place a lead on hold or mark it inactive — ${stage} is not a valid stage.` });
      return;
    }

    // ── Stage-gate: every configured transition must satisfy its required
    //    fields/actions (single source of truth in config/stageRequirements). ─
    if (stage && stage !== prevStage) {
      // Backward-move restriction: once a lead has reached DQL, it cannot be
      // moved backward along the funnel (off-funnel moves like ON_HOLD /
      // INACTIVE remain allowed).
      const fromIdx = FUNNEL_ORDER.indexOf(prevStage as any);
      const toIdx = FUNNEL_ORDER.indexOf(stage as any);
      const isBackwardFunnelMove = fromIdx !== -1 && toIdx !== -1 && toIdx < fromIdx;
      // Only MQL → EL backward move is permitted; all other backward funnel moves are blocked.
      const isMQLtoEL = prevStage === 'MQL' && stage === 'EFFECTIVE_LEAD';
      if (isBackwardFunnelMove && !isMQLtoEL) {
        res.status(400).json({
          error: `Backward stage moves are not permitted except MQL → Effective Lead. The lead cannot be moved backward from ${prevStage}.`,
        });
        return;
      }
      // Structural skip guard: DQL, Proposal Ready and Proposal Discussion are
      // the only stages the agreed spec allows skipping over — every other
      // forward move must go one funnel step at a time, even if the
      // accumulated gate requirements happen to be met.
      if (!isBackwardFunnelMove && !isStageJumpAllowed(prevStage, stage)) {
        res.status(400).json({
          error: `Cannot move directly from ${prevStage} to ${stage} — only DQL, Proposal Ready and Proposal Discussion can be skipped over.`,
        });
        return;
      }
      // NOTE: intentRating is intentionally excluded from the prospective object.
      // The 1-star gate must evaluate the persisted DB value — not a value supplied
      // in this request — so callers cannot bypass the block by sending a non-1
      // rating alongside a stage change. Intent updates must go through the
      // dedicated PATCH /api/leads/:id/intent-rating endpoint which enforces the
      // full audit trail (reason required, intentRatingSource set, log written).
      const prospective = {
        ...existing,
        ...(estimatedValue !== undefined && {
          estimatedValue: estimatedValue === '' || estimatedValue === null ? null : parseFloat(estimatedValue),
        }),
        ...(nextMeetingDate !== undefined && { nextMeetingDate: nextMeetingDate ? new Date(nextMeetingDate) : null }),
        ...(floorPlanUrl !== undefined && { floorPlanUrl: floorPlanUrl || null }),
        // Key-facts fields (Task #20) — needed so gate can check them in the same request
        ...(builder !== undefined && { builder: builder?.trim() || null }),
        ...(scope !== undefined && { scope: scope?.trim() || null }),
        ...(projectType !== undefined && { projectType: projectType?.trim() || null }),
        ...(source !== undefined && { source: source || null }),
        ...(location !== undefined && { location: location?.trim() || null }),
        ...(expectedMoveIn !== undefined && { expectedMoveIn: expectedMoveIn ? new Date(expectedMoveIn) : null }),
        ...(expectedObDate !== undefined && { expectedObDate: expectedObDate ? new Date(expectedObDate) : null }),
      };
      const gate = await checkStageRequirements(prospective, prevStage, stage);
      if (!gate.ok) {
        // `details` (with per-item `type`) rides along so callers like the
        // Pipeline board can offer an actionable fix — e.g. open the PD→OB
        // or OBM→DIP checklist inline — instead of just showing text.
        res.status(400).json({ error: `Cannot move to ${stage}`, missing: gate.missing, details: gate.details });
        return;
      }
    }

    // Stage-skip flags — persisted so downstream views/reports can tell this
    // lead bypassed a stage. Derived generically from FUNNEL_ORDER (rather
    // than a hardcoded list of (from,to) pairs) so any allowed skip
    // combination — e.g. MQL→Proposal Ready, which only skips DQL — sets the
    // right flag(s), not just the three combinations that used to be
    // hardcoded here.
    const skipFromIdx = FUNNEL_ORDER.indexOf(prevStage as any);
    const skipToIdx = FUNNEL_ORDER.indexOf(stage as any);
    const skippedStages = skipFromIdx !== -1 && skipToIdx !== -1 && skipToIdx > skipFromIdx
      ? FUNNEL_ORDER.slice(skipFromIdx + 1, skipToIdx)
      : [];
    const isProposalReadySkip = skippedStages.includes('PROPOSAL_READY' as any);
    const isPpToObSkip = skippedStages.includes('PROPOSAL_DISCUSSION' as any);

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(phone && { phone }),
        ...(phone2 !== undefined && { phone2: phone2 || null }),
        ...(email !== undefined && { email: email || null }),
        ...(source && { source }),
        ...(stage && { stage: stage as any }),
        ...(isProposalReadySkip && { skippedProposalReady: true }),
        ...(isPpToObSkip && { skippedProposalDiscussion: true }),
        ...(projectType !== undefined && { projectType: projectType?.trim() || null }),
        ...(scope !== undefined && { scope: scope?.trim() || null }),
        ...(location !== undefined && { location: location?.trim() || null }),
        ...(estimatedValue !== undefined && {
          estimatedValue: estimatedValue === '' || estimatedValue === null ? null : parseFloat(estimatedValue),
        }),
        // intentRating is intentionally excluded here — all intent updates must
        // go through PATCH /api/leads/:id/intent-rating to enforce the audit
        // trail (reason required, intentRatingSource, IntentRatingLog record).
        ...(possessionTimeline !== undefined && { possessionTimeline: possessionTimeline?.trim() || null }),
        ...(nextMeetingDate !== undefined && { nextMeetingDate: nextMeetingDate ? new Date(nextMeetingDate) : null }),
        ...(floorPlanUrl !== undefined && { floorPlanUrl: floorPlanUrl || null }),
        ...(expectedObDate !== undefined && { expectedObDate: expectedObDate ? new Date(expectedObDate) : null }),
        ...(assignedDesignerId !== undefined && {
          assignedDesignerId: assignedDesignerId || null,
          // Reset firstOpenedAt when designer changes so the new assignee starts unread.
          ...(assignedDesignerId !== existing.assignedDesignerId && { firstOpenedAt: null }),
        }),
        ...(assignedBLId !== undefined && { assignedBLId: assignedBLId || null }),
        ...(customFields && {
          customFields: { ...(existing.customFields as Record<string, unknown> ?? {}), ...customFields },
        }),
        // Task #20 — new key-facts fields
        ...(builder !== undefined && { builder: builder?.trim() || null }),
        ...(offer1 !== undefined && { offer1: offer1?.trim() || null }),
        ...(offer2 !== undefined && { offer2: offer2?.trim() || null }),
        ...(offer3 !== undefined && { offer3: offer3?.trim() || null }),
        ...(expectedMoveIn !== undefined && { expectedMoveIn: expectedMoveIn ? new Date(expectedMoveIn) : null }),
        ...(email2 !== undefined && { email2: email2?.trim() || null }),
        ...(pan !== undefined && { pan: pan?.trim() || null }),
        ...(gst !== undefined && { gst: gst?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
      },
      include: LEAD_INCLUDE,
    });

    // Notify BL when assigned to a lead
    const newBLId = assignedBLId !== undefined ? (assignedBLId || null) : undefined;
    if (newBLId && newBLId !== existing.assignedBLId) {
      await createNotification(
        newBLId,
        'BL_ASSIGNED',
        `You have been assigned as BL for lead ${existing.leadId} — ${existing.name}`,
        id,
      );
      await logActivity(user.id, 'BL_ASSIGNED', id, { blId: newBLId });
    }

    if (stage && stage !== prevStage) {
      await logActivity(user.id, 'STAGE_CHANGED', id, {
        from: prevStage,
        to: stage,
        isBackward: (() => {
          const fi = FUNNEL_ORDER.indexOf(prevStage as any);
          const ti = FUNNEL_ORDER.indexOf(stage as any);
          return fi !== -1 && ti !== -1 && ti < fi;
        })(),
      });

      // ── MQL → EL backward move: notify designer + BL ──────────────────────
      if (prevStage === 'MQL' && stage === 'EFFECTIVE_LEAD') {
        const notifyTargets: { id: string; name: string; email: string }[] = [];
        const targetIds = [existing.assignedDesignerId, existing.assignedBLId].filter(Boolean) as string[];
        if (targetIds.length) {
          const targetUsers = await prisma.user.findMany({
            where: { id: { in: targetIds } },
            select: { id: true, name: true, email: true },
          });
          notifyTargets.push(...targetUsers);
        }
        const msg = `Lead ${existing.leadId} (${existing.name}) moved backward: MQL → Effective Lead by ${user.name}`;
        for (const t of notifyTargets) {
          await createNotification(t.id, 'STAGE_MOVED_BACKWARD', msg, id).catch(() => {});
          const emailPayload = stageMoveBackwardEmail({
            recipientName: t.name,
            leadId: existing.leadId,
            leadName: existing.name,
            fromStage: 'MQL',
            toStage: 'Effective Lead',
            movedByName: user.name,
          });
          emailPayload.to = t.email;
          sendEmail(emailPayload).catch(() => {});
        }
      }

      // BUG-009 Part B: auto-resolve open SLA breaches when moving to a terminal
      // stage. ONBOARDING is included (task #14) because the legacy engine
      // (server/src/jobs/slaCheck.ts) has no OB→OBM rule of its own — without
      // this, a lead could carry a stale breach flag from an earlier stage
      // (e.g. MQL/PROPOSAL_READY) into OB, where only the new stage-SLA
      // system (computeStageSlaStatus, now covering ONBOARDING) should decide
      // breach status.
      if (stage === 'ONBOARDING' || stage === 'DESIGN_IN_PROGRESS' || stage === 'HANDED_OVER') {
        await prisma.sLABreach.updateMany({
          where: { leadId: id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        });
        await prisma.lead.update({ where: { id }, data: { isSLABreached: false } });
      }

      // Auto-create PDOBChecklist when moving to PROPOSAL_DISCUSSION (task
      // #54) — its completion (welcome mail sent) now gates
      // PROPOSAL_DISCUSSION → ONBOARDING. Normally this transition happens
      // via the checklist's own send-welcome-mail action (see
      // routes/pdObChecklist.ts), which upserts this itself; this is a
      // safety net for leads that reach the stage some other way.
      if (stage === 'PROPOSAL_DISCUSSION') {
        await prisma.pDOBChecklist.upsert({
          where: { leadId: id },
          create: { leadId: id },
          update: {},
        });
      }

      // Auto-create OBOBMChecklist when moving to ONBOARDING (task #54) —
      // its completion (OBM mail sent) now gates ONBOARDING →
      // ONBOARDING_MEETING. Safety net; normally created by the PD→OB
      // checklist's send-welcome-mail action.
      if (stage === 'ONBOARDING') {
        await prisma.oBOBMChecklist.upsert({
          where: { leadId: id },
          create: { leadId: id },
          update: {},
        });
      }

      // Auto-create DIPChecklist when moving to ONBOARDING_MEETING (this is
      // what now gates ONBOARDING_MEETING → DESIGN_IN_PROGRESS).
      if (stage === 'ONBOARDING_MEETING') {
        await prisma.dIPChecklist.upsert({
          where: { leadId: id },
          create: { leadId: id },
          update: {},
        });
        if (existing.assignedBLId) {
          await createNotification(
            existing.assignedBLId,
            'ONBOARDING_DIP_REQUIRED',
            `Lead ${existing.leadId} reached Onboarding Meeting — complete DIP checklist to move to Design in Progress`,
            id,
          );
        }
        // NPS: onboarding survey is now owned by the OB→OBM checklist (task
        // #54) — it's a required, manually-triggered checklist item (see
        // routes/obObmChecklist.ts and POST /:id/nps-trigger) rather than an
        // automatic side effect of the stage change, so it isn't duplicated
        // here. This block still auto-creates the DIPChecklist above as a
        // safety net for any path that reaches ONBOARDING_MEETING outside
        // the checklist's own send-obm-mail transition.
      }

      // NPS: trigger sign-off survey when lead reaches DESIGN_IN_PROGRESS
      // (the new terminal/conversion stage — replaces the old HANDED_OVER
      // trigger; HANDED_OVER is kept as a legacy trigger so old data flows
      // are unaffected).
      if (stage === 'DESIGN_IN_PROGRESS' || stage === 'HANDED_OVER') {
        createAndSendNps(id, 'SIGN_OFF').catch(() => {});
      }

      // G5: Auto-assign BL (round-robin) once a lead is qualified and no BL is
      // set yet. Covers both the original "CRE moves lead to MQL" case and
      // ad-sourced leads that are born directly at MQL for CRE qualification
      // (task #77) — those never fire a "move into MQL" transition, so we also
      // catch the moment a CRE progresses one past MQL (DQL or later).
      const mqlIdx = FUNNEL_ORDER.indexOf('MQL' as any);
      const stageIdx = FUNNEL_ORDER.indexOf(stage as any);
      const qualifiedPastMql = mqlIdx !== -1 && stageIdx !== -1 && stageIdx > mqlIdx;
      if ((stage === 'MQL' || qualifiedPastMql) && !lead.assignedBLId) {
        const bl = await selectBLForLead();
        if (bl) {
          await prisma.lead.update({
            where: { id },
            data: { assignedBLId: bl.id },
          });
          await prisma.user.update({
            where: { id: bl.id },
            data: { totalLeadsAssigned: { increment: 1 } },
          });
          await createNotification(
            bl.id,
            'BL_ASSIGNED',
            `You have been assigned as BL for lead ${existing.leadId} — ${existing.name}`,
            id,
          );
          await logActivity(user.id, 'BL_ASSIGNED', id, { blId: bl.id });
        }

        // Task #91 — CRE qualification handoff: ad-webhook leads (and
        // manually-created ones) park a CRE in assignedDesignerId as a
        // round-robin placeholder while the CRE qualifies them (see
        // assignmentService.selectCREForLead / leadWebhooks.ts). Once the
        // lead is qualified enough to reach a BL, that placeholder must be
        // released — otherwise it permanently blocks the real designer
        // round-robin, since assignLeadToDesigner() is only ever invoked
        // behind a `!lead.assignedDesignerId` guard (pdObChecklist.ts) later
        // in the funnel. A real DESIGNER already sitting in the field (e.g.
        // set via direct assignment) must never be cleared here.
        if (lead.assignedDesigner?.role === 'CRE') {
          const designer = await assignLeadToDesigner(
            lead.estimatedValue != null ? Number(lead.estimatedValue) : null,
            bl?.id ?? lead.assignedBLId ?? '',
          );
          await prisma.lead.update({
            where: { id },
            data: { assignedDesignerId: designer ?? null, firstOpenedAt: null },
          });
          if (designer) {
            await incrementAssigned(designer);
            await createNotification(
              designer,
              'DESIGNER_ASSIGNED',
              `You have been assigned as designer for lead ${existing.leadId} — ${existing.name}`,
              id,
            );
          }
          await logActivity(user.id, 'DESIGNER_ASSIGNED', id, {
            designerId: designer ?? null,
            handoffFromCRE: lead.assignedDesigner.id,
          });
        }
      }

      // Intent rating log when moving into MQL (G1/G6)
      if (stage === 'MQL' && prevStage === 'EFFECTIVE_LEAD') {
        try {
          const leadWithRels = await prisma.lead.findUnique({
            where: { id },
            include: {
              calls: { select: { id: true } },
              // mode + deterministic newest-first order so computeSystemRating uses the right meeting
              meetings: { select: { id: true, mode: true, status: true }, orderBy: { createdAt: 'desc' } },
            },
          });
          if (leadWithRels) {
            const systemRating = computeSystemRating(leadWithRels);
            const finalRating = lead.intentRating ?? systemRating;
            const overridden = lead.intentRating !== null && lead.intentRating !== undefined
              && lead.intentRating !== systemRating;
            await prisma.intentRatingLog.create({
              data: {
                leadId: id,
                systemRating,
                finalRating,
                overriddenById: overridden ? user.id : undefined,
                reason: overridden ? 'Manual override on MQL' : undefined,
              },
            });
          }
        } catch (e) {
          console.warn('[leads:intentRatingLog]', (e as Error).message);
        }
      }

      // Auto-create Project when moving to DESIGN_IN_PROGRESS — this is now
      // the funnel's terminal/conversion stage (moved from the old
      // HANDED_OVER trigger; HANDED_OVER kept as a legacy trigger for old
      // data flows still using it directly).
      if (stage === 'DESIGN_IN_PROGRESS' || stage === 'HANDED_OVER') {
        try {
          const alreadyExists = await prisma.project.findUnique({ where: { leadId: id } });
          if (!alreadyExists) {
            const projCounter = await prisma.$transaction(async (tx) => {
              return tx.projectCounter.upsert({
                where: { id: 1 },
                create: { id: 1, lastNum: 1 },
                update: { lastNum: { increment: 1 } },
              });
            });
            const year = new Date().getFullYear();
            const projectCode = `P-${year}-${String(projCounter.lastNum).padStart(4, '0')}`;
            await prisma.project.create({
              data: {
                projectCode,
                leadId: id,
                designerId: lead.assignedDesignerId ?? undefined,
                contractValue: lead.estimatedValue ? Number(lead.estimatedValue) : 0,
                location: lead.location ?? undefined,
              },
            });
            await logActivity(user.id, 'PROJECT_CREATED', id, { projectCode });
          }
        } catch (e) {
          console.warn('[leads:project:create]', (e as Error).message);
        }
      }

    }

    res.json({ lead });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id/assign-direct — BL direct designer assignment ────────
leadsRouter.patch('/:id/assign-direct', verifyToken, requireRole('BL'), async (req, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { designerId } = req.body as { designerId?: string };

    if (!designerId) {
      res.status(400).json({ error: 'designerId is required' });
      return;
    }

    const [lead, designer] = await Promise.all([
      prisma.lead.findUnique({ where: { id }, select: { id: true, leadId: true } }),
      prisma.user.findUnique({ where: { id: designerId }, select: { id: true, name: true, blId: true } }),
    ]);

    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!designer) { res.status(404).json({ error: 'Designer not found' }); return; }

    // Verify designer is on this BL's team
    if (designer.blId !== user.id) {
      res.status(403).json({ error: 'Designer is not on your team' });
      return;
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: {
        assignedDesignerId: designerId,
        assignmentPath: 'DIRECT',
      },
      include: LEAD_INCLUDE,
    });

    // Notify the assigned designer
    await createNotification(
      designerId,
      'DESIGNER_ASSIGNED',
      `You have been assigned lead ${lead.leadId} by ${user.name}`,
      id,
    );

    await logActivity(user.id, 'DIRECT_ASSIGNMENT', id, {
      designerName: designer.name,
      assignedById: user.id,
    });

    res.json({ lead: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/:id/reactivate — reopen an ON_HOLD or INACTIVE lead ───────
// Task #40: mandatory reason (dropdown value, "Other" free-typed) + optional
// notes; always notifies the internal team, optionally emails the client.
// Auto-reactivation on the reopen date itself stays out of scope per the
// founder's direction — this is the manual flow only.
const REACTIVATION_REASONS = [
  'Client re-engaged',
  'Budget approved',
  'Timeline resumed',
  'Placed on hold in error',
  'Other',
];

leadsRouter.post('/:id/reactivate', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { reason, notes, notifyClient } = req.body as { reason?: string; notes?: string; notifyClient?: boolean };

    if (!reason?.trim()) {
      res.status(400).json({ error: 'A reason is required to reactivate this lead.' });
      return;
    }

    try {
      const updated = await reactivateLead({
        leadId: id,
        actorId: user.id,
        actorName: user.name,
        reason: reason.trim(),
        notes: notes?.trim(),
        notifyClient: !!notifyClient,
      });
      res.json({ lead: updated });
    } catch (e: any) {
      if (e.message === 'Lead not found') { res.status(404).json({ error: e.message }); return; }
      res.status(400).json({ error: e.message });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id/status — place On Hold / mark Inactive (task #88) ────
// Status is decoupled from stage: this never touches `stage`, so the lead's
// real funnel position is preserved and both show together (e.g. "DQL — On
// Hold"). Reactivation back to ACTIVE goes through POST /:id/reactivate above.
leadsRouter.patch('/:id/status', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { status, reason, notes, onHoldRevivalDate, notifyClient } = req.body as {
      status?: 'ON_HOLD' | 'INACTIVE'; reason?: string; notes?: string;
      onHoldRevivalDate?: string; notifyClient?: boolean;
    };

    if (status !== 'ON_HOLD' && status !== 'INACTIVE') {
      res.status(400).json({ error: "status must be 'ON_HOLD' or 'INACTIVE'" });
      return;
    }

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (existing.status === status) {
      res.status(400).json({ error: `Lead is already ${status === 'ON_HOLD' ? 'On Hold' : 'Inactive'}.` });
      return;
    }
    // Simplification: to move a fully-inactive lead back to On Hold, reactivate
    // it first — avoids ambiguous "was it ever active again" history.
    if (existing.status === 'INACTIVE' && status === 'ON_HOLD') {
      res.status(400).json({ error: 'Reactivate this lead before placing it on hold again.' });
      return;
    }

    if (status === 'ON_HOLD') {
      if (!reason?.trim()) {
        res.status(400).json({ error: 'A reason is required when placing a lead on hold.' });
        return;
      }
      if (!onHoldRevivalDate) {
        res.status(400).json({ error: 'A reopen date is required when placing a lead on hold.' });
        return;
      }
      const reopenDate = new Date(onHoldRevivalDate);
      if (isNaN(reopenDate.getTime()) || reopenDate <= new Date()) {
        res.status(400).json({ error: 'The reopen date must be a future date.' });
        return;
      }
      const lead = await putLeadOnHold({
        leadId: id, actorId: user.id, actorName: user.name, reason: reason.trim(), revivalDate: reopenDate,
      });
      res.json({ lead });
      return;
    }

    // status === 'INACTIVE'
    const resolvedReason = reason?.trim();
    if (!resolvedReason) {
      res.status(400).json({ error: 'A reason is required when marking a lead as inactive.' });
      return;
    }
    const lead = await markLeadInactive({
      leadId: id, actorId: user.id, actorName: user.name,
      reason: resolvedReason, notes: notes?.trim(), notifyClient: !!notifyClient,
    });
    res.json({ lead });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id/activity ────────────────────────────────────────────────
leadsRouter.get('/:id/activity', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const activities = await prisma.activityLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });
    res.json({ activities });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id/intent-rating { rating, reason } ────────────────────
leadsRouter.patch('/:id/intent-rating', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const { rating, reason } = req.body as { rating?: number; reason?: string };

    if (!rating || rating < 1 || rating > 5) {
      res.status(400).json({ error: 'rating must be an integer from 1 to 5' });
      return;
    }

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: {
        calls: { select: { id: true } },
        // newest-first so computeSystemRating reliably uses the most recent meeting mode
        meetings: { select: { id: true, mode: true, status: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    const oldRating = lead.intentRating;
    const systemRating = computeSystemRating(lead);

    // Reason required when manually overriding the system-computed rating
    if (rating !== systemRating && !reason?.trim()) {
      res.status(400).json({ error: 'reason is required when overriding the system-computed rating' });
      return;
    }

    await prisma.lead.update({ where: { id }, data: { intentRating: rating, intentRatingSource: 'manual' } });

    const log = await prisma.intentRatingLog.create({
      data: {
        leadId: id,
        systemRating,
        finalRating: rating,
        overriddenById: rating !== systemRating ? user.id : undefined,
        reason: reason?.trim() || undefined,
      },
    });

    // Determine change direction for activity log + notifications
    const direction =
      rating > (oldRating ?? 0) ? 'increase'
      : rating < (oldRating ?? 0) ? 'decrease'
      : 'unchanged';

    await logActivity(user.id, 'INTENT_RATING_UPDATED', id, {
      rating, systemRating, reason, oldRating, direction,
    });

    // Notify designer and BL when intent rating actually changes
    if (direction !== 'unchanged') {
      const targetIds = [lead.assignedDesignerId, lead.assignedBLId].filter(Boolean) as string[];
      if (targetIds.length) {
        const targetUsers = await prisma.user.findMany({
          where: { id: { in: targetIds } },
          select: { id: true, name: true, email: true },
        });
        const notifMsg = `Lead ${lead.leadId} (${lead.name}) intent rating ${direction}d: ${oldRating ?? '—'} → ${rating} ★ (by ${user.name})`;
        for (const t of targetUsers) {
          createNotification(t.id, 'INTENT_RATING_CHANGED', notifMsg, id).catch(() => {});
          const emailPayload = intentRatingChangedEmail({
            recipientName: t.name,
            leadId: lead.leadId,
            leadName: lead.name,
            oldRating,
            newRating: rating,
            direction: direction as 'increase' | 'decrease',
            changedByName: user.name,
            reason: reason?.trim(),
          });
          emailPayload.to = t.email;
          sendEmail(emailPayload).catch(() => {});
        }
      }
    }

    res.json({ rating, systemRating, log });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id/stage-history — derive per-stage TAT from activity logs ─
leadsRouter.get('/:id/stage-history', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { id: true, stage: true, createdAt: true },
    });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    const stageLogs = await prisma.activityLog.findMany({
      where: { leadId: id, action: 'STAGE_CHANGED' },
      orderBy: { createdAt: 'asc' },
    });

    // Reconstruct stage visit history from activity log
    type StageVisit = { stage: string; enteredAt: Date; exitedAt?: Date; tatDays?: number };
    const history: StageVisit[] = [];
    // Derive the lead's starting stage from its first logged transition's
    // `from` value so this works for both legacy leads (start at
    // EFFECTIVE_LEAD) and new leads (start at MQL) without hardcoding either.
    // Falls back to the lead's current stage if it never changed stage.
    const firstMeta = stageLogs[0]?.meta as { from?: string; to?: string } | null;
    let currentStage = firstMeta?.from ?? lead.stage;
    let currentEnteredAt = lead.createdAt;

    for (const log of stageLogs) {
      const meta = log.meta as { from?: string; to?: string } | null;
      if (!meta?.to) continue;
      const tatMs = log.createdAt.getTime() - currentEnteredAt.getTime();
      history.push({
        stage: currentStage,
        enteredAt: currentEnteredAt,
        exitedAt: log.createdAt,
        tatDays: Math.max(0, Math.floor(tatMs / (1000 * 60 * 60 * 24))),
      });
      currentStage = meta.to;
      currentEnteredAt = log.createdAt;
    }

    // Current stage (not yet exited)
    const nowMs = Date.now() - currentEnteredAt.getTime();
    history.push({
      stage: currentStage,
      enteredAt: currentEnteredAt,
      tatDays: Math.max(0, Math.floor(nowMs / (1000 * 60 * 60 * 24))),
    });

    // Task #32: attach the admin-configured SLA benchmark for every visited
    // stage so the client can colour-code TAT without duplicating thresholds.
    const thresholds = await getEffectiveStageSla();
    const historyWithBenchmark = history.map((h) => ({
      ...h,
      benchmark: thresholds[h.stage]
        ? { warningDays: thresholds[h.stage].warningDays, breachDays: thresholds[h.stage].breachDays }
        : null,
    }));

    res.json({ history: historyWithBenchmark });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id/intent-rating-history ──────────────────────────────────
leadsRouter.get('/:id/intent-rating-history', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await prisma.intentRatingLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        overriddenBy: { select: { id: true, name: true, role: true } },
      },
    });
    res.json({ history: logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/:id/nps-trigger — manual NPS survey trigger (task #54) ────
// Used by the OB→OBM checklist's "Trigger NPS" button. `stage` defaults to
// 'ONBOARDING' (the milestone this checklist represents); createAndSendNps is
// idempotent per (leadId, stage) so re-clicking is harmless. Also flips the
// OB→OBM checklist's npsTriggered flag when the checklist exists.
leadsRouter.post('/:id/nps-trigger', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const { stage: npsStage } = req.body as { stage?: string };
    const resolvedStage = npsStage?.trim() || 'ONBOARDING';

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { id: true, leadId: true, assignedDesignerId: true, assignedBLId: true },
    });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!(await isAuthorizedForLead(lead, user))) {
      res.status(403).json({ error: 'Not authorised for this lead' });
      return;
    }

    await createAndSendNps(id, resolvedStage);
    await logActivity(user.id, 'NPS_TRIGGERED', id, { stage: resolvedStage });

    const checklist = await prisma.oBOBMChecklist.updateMany({
      where: { leadId: id },
      data: { npsTriggered: true, npsTriggeredAt: new Date() },
    });

    res.json({ ok: true, checklistUpdated: checklist.count > 0 });
  } catch (err: any) {
    console.error('[leads:nps-trigger]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id/can-advance?toStage=STAGE&fromStage=STAGE — gate pre-check ──
// `fromStage` defaults to the lead's current stage (the real, actionable transition).
// Callers (e.g. the stage-roadmap popover) may pass an explicit `fromStage` to preview
// the requirements for a *different* funnel step than the lead is currently on — it
// must be a recognised funnel stage, never arbitrary/free-text input.
leadsRouter.get('/:id/can-advance', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { toStage, fromStage } = req.query as { toStage?: string; fromStage?: string };
    if (!toStage) {
      res.status(400).json({ error: 'toStage query parameter is required' });
      return;
    }
    if (fromStage && !FUNNEL_ORDER.includes(fromStage as any)) {
      res.status(400).json({ error: 'fromStage must be a valid funnel stage' });
      return;
    }
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    // Scope check: same policy as lead detail access
    const { isAuthorizedForLead } = await import('../lib/leadAuth.js');
    if (!(await isAuthorizedForLead(lead, req.user!))) {
      res.status(403).json({ error: 'Not authorised for this lead' });
      return;
    }
    const result = await checkStageRequirements(lead as any, fromStage ?? lead.stage, toStage);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/:id/floor-plan — upload floor plan file to Supabase Storage ──
// Multer errors (LIMIT_FILE_SIZE, malformed multipart) are handled by the inner
// callback so they are always returned as JSON rather than Express's default HTML.
leadsRouter.post('/:id/floor-plan', verifyToken, (req, res, next) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (upload.single('file') as any)(req, res, (err: any) => {
    if (!err) return next();
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File too large. Maximum size is 20 MB.'
      : (err.message ?? 'Invalid or malformed file upload.');
    res.status(status).json({ error: message });
  });
}, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // ── Server-side MIME type allowlist ───────────────────────────────────────
    // Strategy: MIME type is the primary gate.
    //   - Standard types (PDF, images): MIME must be in the known-good set.
    //   - DWG/DXF: browsers report application/octet-stream or a few CAD-specific
    //     types for these; we accept them ONLY when the extension is also dwg/dxf
    //     so a generic binary with any other extension cannot slip through.
    //   - Anything else (text/html, application/javascript, etc.) is rejected
    //     regardless of extension, preventing disguised uploads.
    const STANDARD_MIME = new Set([
      'application/pdf',
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    ]);
    const DWG_DXF_EXT = new Set(['dwg', 'dxf']);
    const DWG_DXF_MIME = new Set([
      'application/octet-stream',
      'image/vnd.dwg', 'image/x-dwg',
      'application/acad', 'application/x-dwg', 'application/x-autocad',
    ]);
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const isStandard = STANDARD_MIME.has(file.mimetype);
    const isCadFile = DWG_DXF_EXT.has(ext) && DWG_DXF_MIME.has(file.mimetype);
    if (!isStandard && !isCadFile) {
      res.status(400).json({ error: `File type not allowed. Accepted: PDF, JPG, PNG, WEBP, DWG, DXF` });
      return;
    }
    // Use only known MIME types for storage; avoid uploading supplied arbitrary MIME
    const safeMime = isStandard ? file.mimetype : 'application/octet-stream';

    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, leadId: true, stage: true, floorPlanUrl: true } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    // Files cannot be replaced once uploaded — only new files may be added.
    if (lead.floorPlanUrl) {
      res.status(405).json({ error: 'A floor plan is already attached and cannot be replaced. Use the Files tab to add a new file.' });
      return;
    }

    if (!supabaseAdmin) {
      res.status(500).json({ error: 'Floor plan storage is not configured — SUPABASE_SERVICE_ROLE_KEY is missing. Contact an admin to configure Supabase Storage.' });
      return;
    }

    const safeExt = (DWG_DXF_EXT.has(ext) || ['pdf','jpg','jpeg','png','webp'].includes(ext)) ? ext : 'pdf';
    const storagePath = `floor-plans/${lead.leadId}/${Date.now()}.${safeExt}`;

    // Ensure bucket exists (idempotent — safe to call even if it already exists
    // with the same settings; a mismatched pre-existing bucket is a one-time
    // setup problem, see scripts/setup-supabase-storage.ts).
    try {
      await supabaseAdmin.storage.createBucket('crm-files', { public: true });
    } catch {
      // Ignore "already exists" — anything else surfaces via the upload call below.
    }

    const { error: uploadError } = await supabaseAdmin.storage
      .from('crm-files')
      .upload(storagePath, file.buffer, { contentType: safeMime, upsert: true });

    if (uploadError) {
      console.error('[leads:floor-plan] Supabase Storage upload failed:', uploadError.message);
      res.status(502).json({
        error: `Could not reach floor plan storage (${uploadError.message}). Verify the "crm-files" bucket exists in Supabase Storage and try again.`,
      });
      return;
    }

    const { data: { publicUrl } } = supabaseAdmin.storage.from('crm-files').getPublicUrl(storagePath);

    // Also record it as a proper LeadFile at the lead's *current* stage so it
    // shows up in the Files tab immediately — whichever of EL/MQL/DQL the lead
    // happens to be in at upload time (task #30). `floorPlanUrl` is kept in
    // sync too for older code paths that still read it directly.
    const fileStage = (['EFFECTIVE_LEAD', 'MQL', 'DQL'] as const).includes(lead.stage as any) ? lead.stage : 'MQL';
    await prisma.$transaction([
      prisma.lead.update({ where: { id }, data: { floorPlanUrl: publicUrl } }),
      prisma.leadFile.create({
        data: {
          leadId: id,
          stage: fileStage as any,
          fileType: 'FLOOR_PLAN',
          fileName: file.originalname,
          storagePath: `crm-files:${storagePath}`,
          uploadedById: user.id,
        },
      }),
    ]);
    await logActivity(user.id, 'FLOOR_PLAN_UPLOADED', id, { url: publicUrl, fileName: file.originalname });

    res.json({ url: publicUrl });
  } catch (err: any) {
    console.error('[leads:floor-plan]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/:id/notes ─────────────────────────────────────────────────
leadsRouter.post('/:id/notes', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const { note } = req.body as { note?: string };
    if (!note?.trim()) { res.status(400).json({ error: 'note is required' }); return; }
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    await logActivity(user.id, 'NOTE_ADDED', id, { note: note.trim() });
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
