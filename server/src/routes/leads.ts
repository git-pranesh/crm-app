import { randomUUID } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../lib/prisma.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';
import { sendSms } from '../services/smsService.js';
import { sendEmail, inactivationEmail, onHoldEmail, stageMoveBackwardEmail, intentRatingChangedEmail } from '../lib/email.js';
import { sendWhatsAppMessage, fillTemplate } from '../lib/whatsapp.js';
import { selectBLForLead } from '../services/assignmentService.js';
import { checkStageRequirements, FUNNEL_ORDER } from '../config/stageRequirements.js';
import { computeSystemRating } from '../services/intentScoring.js';

// ── Validation helpers ────────────────────────────────────────────────────────
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/[\s\-().+]/g, '');
  return /^\d{7,15}$/.test(digits);
}

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
    where: { isOverdue: true, isCompleted: false },
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
    } = req.query as Record<string, string>;

    const user = req.user!;
    const where: any = {};

    // Role-scope — G3: DESIGNER and CRE have separate clauses
    if (user.role === 'DESIGNER') {
      where.assignedDesignerId = user.id;
    } else if (user.role === 'CRE') {
      where.OR = [
        { assignedDesignerId: user.id },
        { createdById: user.id },
      ];
    } else if (user.role === 'BL') {
      const members = await prisma.user.findMany({
        where: { blId: user.id, isActive: true },
        select: { id: true },
      });
      // BL sees leads assigned to their team OR directly assigned to them as BL
      where.AND = [
        {
          OR: [
            { assignedDesignerId: { in: [user.id, ...members.map((m) => m.id)] } },
            { assignedBLId: user.id },
          ],
        },
      ];
    }

    // BUG-005: status → stage-set mapping (stage= takes precedence if both supplied)
    const statusToStages: Record<string, string[]> = {
      ACTIVE: ['EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED', 'ONBOARDING'],
      ON_HOLD: ['ON_HOLD'],
      INACTIVE: ['INACTIVE'],
    };
    if (stage) {
      where.stage = stage;
    } else if (status && statusToStages[status]) {
      where.stage = { in: statusToStages[status] };
    }
    if (source) where.source = source;
    if (designerId) where.assignedDesignerId = designerId;
    if (blId) where.assignedBLId = blId;
    if (isSLABreached === 'true') where.isSLABreached = true;
    // G2: new filter params
    if (projectType) where.projectType = projectType;
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (intent) where.intentRating = parseInt(intent);
    if (dateRange) {
      const [from, to] = (dateRange as string).split(',');
      where.createdAt = { gte: new Date(from), lte: new Date(to) };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { leadId: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
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

    res.json({ leads, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
  } catch (err: any) {
    console.error('[leads:list]', err.message);
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

    if (!name?.trim() || !phone?.trim()) {
      res.status(400).json({ error: 'name and phone are required' });
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
        assignedBLId: assignedBLId || (user.role === 'BL' ? user.id : (['CRE', 'DESIGNER'].includes(user.role) && user.blId ? user.blId : undefined)),
        createdById: user.id,
        stage: 'EFFECTIVE_LEAD',
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
          stage: 'EFFECTIVE_LEAD',
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

// ── GET /api/leads/export — download filtered leads as CSV ───────────────────
leadsRouter.get('/export', verifyToken, async (req, res) => {
  try {
    const {
      stage, source, designerId, blId, search,
      projectType, location, dateRange, intent,
      status,
    } = req.query as Record<string, string>;

    const user = req.user!;
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

    const statusToStages: Record<string, string[]> = {
      ACTIVE: ['EFFECTIVE_LEAD', 'MQL', 'DQL', 'PROPOSAL_READY', 'PROPOSAL_PRESENTED', 'ONBOARDING'],
      ON_HOLD: ['ON_HOLD'],
      INACTIVE: ['INACTIVE'],
    };
    if (stage) {
      where.stage = stage;
    } else if (status && statusToStages[status]) {
      where.stage = { in: statusToStages[status] };
    }
    if (source) where.source = source;
    if (designerId) where.assignedDesignerId = designerId;
    if (blId) where.assignedBLId = blId;
    if (projectType) where.projectType = projectType;
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { leadId: { contains: search, mode: 'insensitive' } },
      ];
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

    const header = 'Lead ID,Name,Phone,Email,Stage,Source,Estimated Value,Intent Rating,Designer,BL,Created At\n';
    const rows = leads.map((l: any) => [
      l.leadId,
      `"${(l.name ?? '').replace(/"/g, '""')}"`,
      l.phone ?? '',
      l.email ?? '',
      l.stage,
      l.source ?? '',
      l.estimatedValue ?? '',
      l.intentRating ?? '',
      `"${(l.assignedDesigner?.name ?? '').replace(/"/g, '""')}"`,
      `"${(l.assignedBL?.name ?? '').replace(/"/g, '""')}"`,
      l.createdAt.toISOString(),
    ].join(','));
    const csv = header + rows.join('\n');

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
      },
    });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json({ lead });
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
      onHoldRevivalDate, customFields,
      inactivationReason,
      reason,
      // Task #20 — new key-facts fields
      builder, offer1, offer2, offer3, expectedMoveIn,
      email2, pan, gst, notes,
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

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Lead not found' }); return; }

    const prevStage = existing.stage;

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
      };
      const gate = await checkStageRequirements(prospective, prevStage, stage);
      if (!gate.ok) {
        res.status(400).json({ error: `Cannot move to ${stage}`, missing: gate.missing });
        return;
      }
    }

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(phone && { phone }),
        ...(phone2 !== undefined && { phone2: phone2 || null }),
        ...(email !== undefined && { email: email || null }),
        ...(source && { source }),
        ...(stage && { stage: stage as any }),
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
        ...(assignedDesignerId !== undefined && { assignedDesignerId: assignedDesignerId || null }),
        ...(assignedBLId !== undefined && { assignedBLId: assignedBLId || null }),
        ...(onHoldRevivalDate && { onHoldRevivalDate: new Date(onHoldRevivalDate) }),
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

      // BUG-009 Part B: auto-resolve open SLA breaches when moving to a terminal stage
      if (stage === 'HANDED_OVER' || stage === 'INACTIVE') {
        await prisma.sLABreach.updateMany({
          where: { leadId: id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        });
        await prisma.lead.update({ where: { id }, data: { isSLABreached: false } });
      }

      // Auto-create DIPChecklist when moving to ONBOARDING
      if (stage === 'ONBOARDING') {
        await prisma.dIPChecklist.upsert({
          where: { leadId: id },
          create: { leadId: id },
          update: {},
        });
        if (existing.assignedBLId) {
          await createNotification(
            existing.assignedBLId,
            'ONBOARDING_DIP_REQUIRED',
            `Lead ${existing.leadId} onboarded — complete DIP checklist to close the sales task`,
            id,
          );
        }
      }

      // G5: Auto-assign BL when CRE moves lead to MQL and no BL is set
      if (stage === 'MQL' && !lead.assignedBLId) {
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

      // Auto-create Project when moving to HANDED_OVER (G3)
      if (stage === 'HANDED_OVER') {
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

      // ON_HOLD notifications — SMS, Email, WhatsApp (all independent)
      if (stage === 'ON_HOLD' && existing.phone) {
        const revivalStr = onHoldRevivalDate
          ? new Date(onHoldRevivalDate).toLocaleDateString('en-IN')
          : 'a future date';
        const holdReason = reason ?? 'To be confirmed';

        sendSms(
          existing.phone,
          `Hi ${existing.name}, your Interiors by DeX project has been put on hold until ${revivalStr}. We'll be in touch. - Interiors by DeX`,
          id,
        ).catch((e) => console.warn('[leads:sms:on_hold]', e.message));

        // G1: Email
        if (existing.email) {
          try {
            const emailPayload = onHoldEmail({
              clientName: existing.name,
              revivalDate: revivalStr,
              reason: holdReason,
            });
            emailPayload.to = existing.email;
            await sendEmail(emailPayload);
            await prisma.emailLog.create({
              data: {
                leadId: id,
                type: 'ON_HOLD',
                sentTo: existing.email,
                subject: emailPayload.subject,
              },
            });
          } catch (e) {
            console.error('[ON_HOLD email failed]', e);
          }
        }

        // G1: WhatsApp — only persist the message if it was actually delivered.
        // sendWhatsAppMessage returns null when Twilio is unconfigured (dev) and
        // throws on real failures; in neither case do we store a phantom "sent" bubble.
        try {
          const waBody = fillTemplate('on_hold_notification', {
            clientName: existing.name,
            revivalDate: revivalStr,
            reason: holdReason,
          });
          const twilioSid = await sendWhatsAppMessage(existing.phone, waBody);
          if (twilioSid) {
            await prisma.whatsAppMessage.create({
              data: {
                leadId: id,
                direction: 'OUTBOUND',
                body: waBody,
                templateId: 'on_hold_notification',
                twilioSid,
              },
            });
          }
        } catch (e) {
          console.error('[ON_HOLD whatsapp failed]', e);
        }
      }

      // INACTIVE — create feedback record, send email + SMS
      if (stage === 'INACTIVE') {
        const formToken = randomUUID();
        const baseUrl = process.env.BASE_URL ?? '';
        const feedbackUrl = `${baseUrl}/feedback/${formToken}`;

        await prisma.inactivationFeedback.upsert({
          where: { leadId: id },
          create: {
            leadId: id,
            reason: inactivationReason ?? 'Not specified',
            formToken,
            feedbackFormSentAt: new Date(),
          },
          update: {
            reason: inactivationReason ?? 'Not specified',
            formToken,
            feedbackFormSentAt: new Date(),
            respondedAt: null,
            clientResponse: null,
          },
        });

        if (existing.email) {
          const emailPayload = inactivationEmail({
            clientName: existing.name,
            feedbackUrl,
            reason: inactivationReason,
          });
          emailPayload.to = existing.email;
          sendEmail(emailPayload).catch((e) => console.warn('[leads:email:inactive]', e.message));

          await prisma.emailLog.create({
            data: {
              leadId: id,
              type: 'INACTIVATION_FEEDBACK',
              sentTo: existing.email,
              subject: emailPayload.subject,
            },
          });
        }

        if (existing.phone) {
          sendSms(
            existing.phone,
            `Hi ${existing.name}, thank you for your interest in Interiors by DeX. We'd love your feedback: ${feedbackUrl} - Interiors by DeX`,
            id,
          ).catch((e) => console.warn('[leads:sms:inactive]', e.message));
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
    let currentStage = 'EFFECTIVE_LEAD';
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

    res.json({ history });
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

// ── GET /api/leads/:id/can-advance?toStage=STAGE — gate pre-check ────────────
leadsRouter.get('/:id/can-advance', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { toStage } = req.query as { toStage?: string };
    if (!toStage) {
      res.status(400).json({ error: 'toStage query parameter is required' });
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
    const result = await checkStageRequirements(lead as any, lead.stage, toStage);
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

    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, leadId: true } });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

    if (!supabaseAdmin) {
      res.status(500).json({ error: 'Supabase storage not configured (SUPABASE_SERVICE_ROLE_KEY missing)' });
      return;
    }

    const safeExt = (DWG_DXF_EXT.has(ext) || ['pdf','jpg','jpeg','png','webp'].includes(ext)) ? ext : 'pdf';
    const storagePath = `floor-plans/${lead.leadId}/${Date.now()}.${safeExt}`;

    // Ensure bucket exists (idempotent)
    await supabaseAdmin.storage.createBucket('crm-files', { public: true }).catch(() => {});

    const { error: uploadError } = await supabaseAdmin.storage
      .from('crm-files')
      .upload(storagePath, file.buffer, { contentType: safeMime, upsert: true });

    if (uploadError) {
      res.status(500).json({ error: uploadError.message });
      return;
    }

    const { data: { publicUrl } } = supabaseAdmin.storage.from('crm-files').getPublicUrl(storagePath);

    await prisma.lead.update({ where: { id }, data: { floorPlanUrl: publicUrl } });
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
