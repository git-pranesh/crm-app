import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';

export const projectsRouter = Router();

// ── Build designer-scope where clause ─────────────────────────────────────────
async function buildProjectWhere(user: { id: string; role: string; blId?: string | null }) {
  if (user.role === 'DESIGNER' || user.role === 'CRE') {
    return { designerId: user.id };
  }
  if (user.role === 'BL') {
    const members = await prisma.user.findMany({
      where: { blId: user.id, isActive: true },
      select: { id: true },
    });
    return { designerId: { in: [user.id, ...members.map((m) => m.id)] } };
  }
  return {}; // BRANCH_HEAD — all projects
}

// ── GET /api/projects — role-scoped list ─────────────────────────────────────
projectsRouter.get('/', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const { phase, health } = req.query as { phase?: string; health?: string };

    const scopeWhere = await buildProjectWhere(user);
    const where: any = { ...scopeWhere };
    if (phase) where.phase = phase;
    if (health) where.health = health;

    const projects = await prisma.project.findMany({
      where,
      include: {
        lead: { select: { id: true, leadId: true, name: true, phone: true } },
        designer: { select: { id: true, name: true } },
        _count: { select: { collections: true, attentionFlags: true } },
        attentionFlags: {
          where: { resolvedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ projects, total: projects.length });
  } catch (err: any) {
    console.error('[projects:list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/projects/pipeline — designer's active project pipeline ──────────
// Must be placed BEFORE /:id to avoid the param matcher swallowing "pipeline".
projectsRouter.get('/pipeline', verifyToken, async (req, res) => {
  try {
    const user = req.user!;

    // Only DESIGNER and CRE have a Design Pipeline view.
    // BL/BRANCH_HEAD can call /api/projects directly for team project lists.
    if (user.role !== 'DESIGNER' && user.role !== 'CRE') {
      res.status(403).json({ error: 'Design Pipeline is only available to DESIGNER and CRE roles' });
      return;
    }

    const projects = await prisma.project.findMany({
      where: {
        designerId: user.id,
        phase: { not: 'COMPLETED' },
      },
      include: {
        lead: {
          select: {
            id: true,
            leadId: true,
            name: true,
            phone: true,
            expectedMoveIn: true,
            estimatedValue: true,
          },
        },
        attentionFlags: {
          where: { resolvedAt: null },
          select: { id: true, category: true, description: true },
        },
        _count: { select: { collections: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const now = Date.now();
    const result = projects.map((p) => ({
      id: p.id,
      projectCode: p.projectCode,
      phase: p.phase,
      health: p.health,
      progressPercent: p.progressPercent,
      contractValue: p.contractValue != null ? Number(p.contractValue) : null,
      outstandingAmount: p.outstandingAmount != null ? Number(p.outstandingAmount) : null,
      handoverTargetDate: p.handoverTargetDate?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      totalActiveDays: Math.floor((now - p.createdAt.getTime()) / 86_400_000),
      collectionsCount: p._count.collections,
      attentionFlags: p.attentionFlags,
      lead: {
        id: p.lead.id,
        leadId: p.lead.leadId,
        name: p.lead.name,
        phone: p.lead.phone,
        expectedMoveIn: p.lead.expectedMoveIn?.toISOString() ?? null,
        estimatedValue: p.lead.estimatedValue != null ? Number(p.lead.estimatedValue) : null,
      },
    }));

    res.json({ projects: result, total: result.length });
  } catch (err: any) {
    console.error('[projects:pipeline]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/projects/:id — project detail ───────────────────────────────────
projectsRouter.get('/:id', verifyToken, async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        lead: { select: { id: true, leadId: true, name: true, phone: true, email: true } },
        designer: { select: { id: true, name: true } },
        collections: { orderBy: { dueDate: 'asc' } },
        attentionFlags: { orderBy: { createdAt: 'desc' } },
        npsResponses: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }
    res.json({ project });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/projects/:id — update phase, health, progress, dates ───────────
projectsRouter.patch('/:id', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { phase, health, progressPercent, handoverTargetDate, outstandingAmount } = req.body as {
      phase?: string; health?: string; progressPercent?: number;
      handoverTargetDate?: string; outstandingAmount?: number;
    };

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Project not found' }); return; }

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(phase && { phase: phase as any }),
        ...(health && { health: health as any }),
        ...(progressPercent !== undefined && { progressPercent }),
        ...(handoverTargetDate && { handoverTargetDate: new Date(handoverTargetDate) }),
        ...(outstandingAmount !== undefined && { outstandingAmount }),
      },
      include: {
        lead: { select: { id: true, leadId: true, name: true } },
        designer: { select: { id: true, name: true } },
      },
    });

    await logActivity(user.id, 'PROJECT_UPDATED', project.lead.id, {
      projectId: id,
      changes: { phase, health, progressPercent },
    });

    res.json({ project });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/projects/:id/attention-flag — flag an issue ────────────────────
projectsRouter.post('/:id/attention-flag', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { category, description } = req.body as { category?: string; description?: string };

    if (!category?.trim() || !description?.trim()) {
      res.status(400).json({ error: 'category and description are required' });
      return;
    }

    const project = await prisma.project.findUnique({
      where: { id },
      include: { lead: { select: { id: true, leadId: true } } },
    });
    if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

    const flag = await prisma.projectAttentionFlag.create({
      data: { projectId: id, category, description },
    });

    await logActivity(user.id, 'ATTENTION_FLAG_ADDED', project.lead.id, {
      projectId: id, category, description,
    });

    res.status(201).json({ flag });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/projects/:id/attention-flag/:flagId/resolve ───────────────────
projectsRouter.patch('/:id/attention-flag/:flagId/resolve', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const { id, flagId } = req.params;

    const flag = await prisma.projectAttentionFlag.findUnique({ where: { id: flagId } });
    if (!flag) { res.status(404).json({ error: 'Flag not found' }); return; }
    if (flag.projectId !== id) { res.status(400).json({ error: 'Flag does not belong to this project' }); return; }

    const resolved = await prisma.projectAttentionFlag.update({
      where: { id: flagId },
      data: { resolvedAt: new Date() },
    });

    const project = await prisma.project.findUnique({
      where: { id },
      include: { lead: { select: { id: true } } },
    });
    if (project?.lead) {
      await logActivity(user.id, 'ATTENTION_FLAG_RESOLVED', project.lead.id, { flagId });
    }

    res.json({ flag: resolved });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
