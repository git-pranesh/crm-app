import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';

export const adminRouter = Router();

adminRouter.use(verifyToken, requireRole('BRANCH_HEAD'));

// ── GET /api/admin/users ───────────────────────────────────────────────────────
adminRouter.get('/users', async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        _count: { select: { designerLeads: true, blLeads: true } },
        bl: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/invite — create user record (Supabase handles email) ─
adminRouter.post('/users/invite', async (req, res) => {
  try {
    const { name, email, role, blId } = req.body as {
      name?: string; email?: string; role?: string; blId?: string;
    };
    if (!name?.trim() || !email?.trim() || !role) {
      res.status(400).json({ error: 'name, email, and role are required' });
      return;
    }
    const validRoles = ['DESIGNER', 'CRE', 'BL', 'BRANCH_HEAD'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      return;
    }

    // Try to invite via Supabase Admin API (requires SERVICE_ROLE_KEY)
    let supabaseId = `pending-${Date.now()}`;
    try {
      if (supabaseAdmin) {
        const { data, error } = await (supabaseAdmin as any).auth.admin.inviteUserByEmail(email);
        if (data?.user?.id) supabaseId = data.user.id;
        if (error) console.warn('[admin:invite] Supabase invite error:', error.message);
      }
    } catch (e) {
      console.warn('[admin:invite] Supabase admin not available — creating user record only');
    }

    const user = await prisma.user.create({
      data: {
        supabaseId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        role: role as any,
        blId: blId || undefined,
        isActive: true,
      },
    });
    res.status(201).json({ user, note: 'User created. Supabase invite email sent if SERVICE_ROLE_KEY is configured.' });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'A user with this email already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── PATCH /api/admin/users/:id/deactivate ─────────────────────────────────────
adminRouter.patch('/users/:id/deactivate', async (req, res) => {
  try {
    const { id } = req.params;
    const { reassignDesignerId, reassignBLId } = req.body as {
      reassignDesignerId?: string; reassignBLId?: string;
    };

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // Reassign leads if requested
    const ops: Promise<any>[] = [
      prisma.user.update({ where: { id }, data: { isActive: false } }),
    ];
    if (reassignDesignerId) {
      ops.push(prisma.lead.updateMany({
        where: { assignedDesignerId: id },
        data: { assignedDesignerId: reassignDesignerId },
      }));
    }
    if (reassignBLId) {
      ops.push(prisma.lead.updateMany({
        where: { assignedBLId: id },
        data: { assignedBLId: reassignBLId },
      }));
    }
    await Promise.all(ops);

    const affected = reassignDesignerId || reassignBLId
      ? await prisma.lead.count({ where: { assignedDesignerId: reassignDesignerId ?? id } })
      : 0;
    res.json({ message: `User deactivated. ${affected} leads reassigned.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/users/:id — update user (role, blId, name) ──────────────
adminRouter.patch('/users/:id', async (req, res) => {
  try {
    const { name, role, blId, isActive } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(role && { role: role as any }),
        ...(blId !== undefined && { blId: blId || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json({ user });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/report-schedules ───────────────────────────────────────────
adminRouter.get('/report-schedules', async (_req, res) => {
  try {
    const schedules = await prisma.reportSchedule.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ schedules });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/report-schedules ─────────────────────────────────────────
adminRouter.post('/report-schedules', async (req, res) => {
  try {
    const { type, recipients } = req.body as { type?: string; recipients?: string[] };
    if (!type || !['WEEKLY', 'MONTHLY'].includes(type)) {
      res.status(400).json({ error: 'type must be WEEKLY or MONTHLY' });
      return;
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      res.status(400).json({ error: 'recipients must be a non-empty array of userId' });
      return;
    }
    const schedule = await prisma.reportSchedule.create({ data: { type, recipients } });
    res.status(201).json({ schedule });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/report-schedules/:id ────────────────────────────────────
adminRouter.patch('/report-schedules/:id', async (req, res) => {
  try {
    const { recipients } = req.body as { recipients?: string[] };
    const schedule = await prisma.reportSchedule.update({
      where: { id: req.params.id },
      data: { ...(Array.isArray(recipients) && { recipients }) },
    });
    res.json({ schedule });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/admin/report-schedules/:id ───────────────────────────────────
adminRouter.delete('/report-schedules/:id', async (req, res) => {
  try {
    await prisma.reportSchedule.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/health — system health ─────────────────────────────────────
adminRouter.get('/health', async (_req, res) => {
  try {
    const [
      totalLeads, totalUsers, activeBreaches, recentWebhooks,
      schedules,
    ] = await Promise.all([
      prisma.lead.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.sLABreach.count({ where: { resolvedAt: null } }),
      prisma.activityLog.findMany({
        where: { action: { contains: 'WEBHOOK' } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { action: true, createdAt: true, meta: true },
      }),
      prisma.reportSchedule.findMany({ select: { type: true, lastSentAt: true } }),
    ]);

    res.json({
      db: 'connected',
      totalLeads, totalUsers, activeBreaches,
      reportSchedules: schedules,
      recentWebhookEvents: recentWebhooks,
      redisConfigured: !!(process.env.REDIS_URL && !process.env.REDIS_URL.includes('localhost')),
      smtpConfigured: !!process.env.SMTP_HOST,
      twilioConfigured: !!process.env.TWILIO_ACCOUNT_SID,
      metaConfigured: !!process.env.META_PAGE_ACCESS_TOKEN,
      baseUrl: process.env.BASE_URL ?? 'http://localhost:3001',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
