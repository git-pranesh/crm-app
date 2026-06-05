import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { runSLACheck } from '../jobs/slaCheck.js';
import { runMidnightCheck } from '../jobs/midnightOverdueTask.js';
import { runPerformanceRecalc } from '../jobs/performanceRecalc.js';

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

    // Step 1 — reassign leads if targets provided
    const reassignOps: Promise<any>[] = [];
    if (reassignDesignerId) {
      reassignOps.push(prisma.lead.updateMany({
        where: { assignedDesignerId: id },
        data: { assignedDesignerId: reassignDesignerId },
      }));
    }
    if (reassignBLId) {
      reassignOps.push(prisma.lead.updateMany({
        where: { assignedBLId: id },
        data: { assignedBLId: reassignBLId },
      }));
    }
    if (reassignOps.length) await Promise.all(reassignOps);

    // Step 2 — block if active leads still remain after reassignment
    const remainingLeads = await prisma.lead.count({
      where: {
        OR: [{ assignedDesignerId: id }, { assignedBLId: id }],
        stage: { notIn: ['INACTIVE', 'ON_HOLD', 'HANDED_OVER'] },
      },
    });

    if (remainingLeads > 0) {
      res.status(409).json({
        message: `Reassign all ${remainingLeads} remaining lead(s) before deactivating`,
        count: remainingLeads,
      });
      return;
    }

    // Step 3 — deactivate
    await prisma.user.update({ where: { id }, data: { isActive: false } });

    const affected = (reassignDesignerId || reassignBLId)
      ? await prisma.lead.count({ where: { assignedDesignerId: reassignDesignerId ?? undefined } })
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

// ── GET /api/admin/users/:id/deactivation-preview ─────────────────────────────
adminRouter.get('/users/:id/deactivation-preview', async (req, res) => {
  try {
    const { id } = req.params;
    const leads = await prisma.lead.findMany({
      where: {
        OR: [{ assignedDesignerId: id }, { assignedBLId: id }],
        stage: { notIn: ['INACTIVE', 'ON_HOLD', 'HANDED_OVER'] },
      },
      select: { id: true, leadId: true, name: true, stage: true },
      take: 100,
    });
    res.json({ activeLeads: leads.length, leads });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/:id/reassign-leads ──────────────────────────────────
adminRouter.post('/users/:id/reassign-leads', async (req, res) => {
  try {
    const { id } = req.params;
    const { reassignToUserId } = req.body as { reassignToUserId?: string };
    if (!reassignToUserId) {
      res.status(400).json({ error: 'reassignToUserId is required' });
      return;
    }
    const targetUser = await prisma.user.findUnique({
      where: { id: reassignToUserId },
      select: { id: true, role: true, blId: true },
    });
    if (!targetUser) { res.status(404).json({ error: 'Target user not found' }); return; }

    const [designerCount, blCount] = await Promise.all([
      prisma.lead.updateMany({
        where: { assignedDesignerId: id },
        data: { assignedDesignerId: reassignToUserId },
      }),
      prisma.lead.updateMany({
        where: { assignedBLId: id },
        data: { assignedBLId: reassignToUserId },
      }),
    ]);

    res.json({
      message: `Reassigned ${designerCount.count + blCount.count} lead(s) to new user`,
      designerLeadsReassigned: designerCount.count,
      blLeadsReassigned: blCount.count,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/invites — list pending invites ─────────────────────────────
adminRouter.get('/invites', async (_req, res) => {
  try {
    const invites = await prisma.userInvite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { invitedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ invites });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/users/send-invite — UserInvite-based invite flow ──────────
adminRouter.post('/users/send-invite', async (req, res) => {
  try {
    const adminUser = (req as any).user!;
    const { name, email, role } = req.body as { name?: string; email?: string; role?: string };
    if (!name?.trim() || !email?.trim() || !role) {
      res.status(400).json({ error: 'name, email, and role are required' });
      return;
    }
    const validRoles = ['DESIGNER', 'CRE', 'BL', 'BRANCH_HEAD'];
    if (!validRoles.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      return;
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
    const invite = await prisma.userInvite.create({
      data: {
        email: email.toLowerCase().trim(),
        role: role as any,
        name: name.trim(),
        invitedById: adminUser.id,
        expiresAt,
      },
    });

    const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';
    const inviteLink = `${baseUrl}/accept-invite/${invite.token}`;

    // Send invite email (via email service if configured, else log)
    if (!process.env.SMTP_HOST) {
      console.log(`[admin:invite] INVITE LINK for ${email}: ${inviteLink}`);
    } else {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from: process.env.FROM_EMAIL ?? 'noreply@interiorsbydex.com',
        to: email,
        subject: "You've been invited to Interiors by DeX CRM",
        html: `<p>Hi ${name},</p><p>You've been invited to join Interiors by DeX CRM as <strong>${role}</strong>.</p><p>Click the link below to set up your account (expires in 48 hours):</p><p><a href="${inviteLink}">${inviteLink}</a></p>`,
      }).catch((e: any) => console.warn('[admin:invite] Email send failed:', e.message));
    }

    res.status(201).json({
      invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt },
      inviteLink,
      note: process.env.SMTP_HOST ? 'Invite email sent' : 'SMTP not configured — invite link logged to console',
    });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'An active invite for this email already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── GET /api/admin/intent-ratings ────────────────────────────────────────────
adminRouter.get('/intent-ratings', async (_req, res) => {
  try {
    const ratings = await prisma.intentRatingConfig.findMany({ orderBy: { rating: 'asc' } });
    res.json({ ratings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/intent-ratings — upsert all 5 ratings at once ───────────
adminRouter.patch('/intent-ratings', async (req, res) => {
  try {
    const { ratings } = req.body as {
      ratings?: Array<{ rating: number; label: string; description: string; color?: string }>;
    };
    if (!Array.isArray(ratings)) {
      res.status(400).json({ error: 'ratings must be an array' });
      return;
    }
    const ops = ratings.map((r) =>
      prisma.intentRatingConfig.upsert({
        where: { rating: r.rating },
        create: { rating: r.rating, label: r.label, description: r.description, color: r.color ?? '#6b7280' },
        update: { label: r.label, description: r.description, ...(r.color && { color: r.color }) },
      }),
    );
    await Promise.all(ops);
    const updated = await prisma.intentRatingConfig.findMany({ orderBy: { rating: 'asc' } });
    res.json({ ratings: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/custom-fields ─────────────────────────────────────────────
adminRouter.get('/custom-fields', async (_req, res) => {
  try {
    const fields = await prisma.customFieldDefinition.findMany({ orderBy: { createdAt: 'asc' } });
    res.json({ fields });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/custom-fields ────────────────────────────────────────────
adminRouter.post('/custom-fields', async (req, res) => {
  try {
    const { key, label, fieldType, selectOptions } = req.body as {
      key?: string; label?: string; fieldType?: string; selectOptions?: unknown[];
    };
    if (!key?.trim() || !label?.trim() || !fieldType) {
      res.status(400).json({ error: 'key, label, and fieldType are required' });
      return;
    }
    const validTypes = ['TEXT', 'NUMBER', 'DATE', 'SELECT'];
    if (!validTypes.includes(fieldType)) {
      res.status(400).json({ error: `fieldType must be one of: ${validTypes.join(', ')}` });
      return;
    }
    const field = await prisma.customFieldDefinition.create({
      data: {
        key: key.trim().toLowerCase().replace(/\s+/g, '_'),
        label: label.trim(),
        fieldType: fieldType as any,
        selectOptions: selectOptions ?? undefined,
      },
    });
    res.status(201).json({ field });
  } catch (err: any) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'A custom field with this key already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── PATCH /api/admin/custom-fields/:id ───────────────────────────────────────
adminRouter.patch('/custom-fields/:id', async (req, res) => {
  try {
    const { label, selectOptions, isActive } = req.body;
    const field = await prisma.customFieldDefinition.update({
      where: { id: req.params.id },
      data: {
        ...(label && { label }),
        ...(selectOptions !== undefined && { selectOptions }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json({ field });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/admin/custom-fields/:id — soft delete ─────────────────────────
adminRouter.delete('/custom-fields/:id', async (req, res) => {
  try {
    const field = await prisma.customFieldDefinition.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ field, note: 'Soft deleted — historical data preserved' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/assignment-config ─────────────────────────────────────────
adminRouter.get('/assignment-config', async (_req, res) => {
  try {
    const configs = await prisma.assignmentConfig.findMany();
    const map: Record<string, unknown> = {};
    for (const c of configs) map[c.key] = c.value;
    const smartEnabled = process.env.SMART_ASSIGNMENT_ENABLED === 'true';
    res.json({
      smartAssignmentEnabled: smartEnabled,
      premiumThresholdValue: map['premium_threshold_value'] ?? 2000000,
      standardThresholdValue: map['standard_threshold_value'] ?? 500000,
      note: 'Set SMART_ASSIGNMENT_ENABLED=true in env to activate smart assignment',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/assignment-config ─────────────────────────────────────────
adminRouter.post('/assignment-config', async (req, res) => {
  try {
    const { premiumThresholdValue, standardThresholdValue } = req.body as {
      premiumThresholdValue?: number;
      standardThresholdValue?: number;
    };
    const ops = [];
    if (premiumThresholdValue !== undefined) {
      ops.push(prisma.assignmentConfig.upsert({
        where: { key: 'premium_threshold_value' },
        create: { key: 'premium_threshold_value', value: premiumThresholdValue },
        update: { value: premiumThresholdValue },
      }));
    }
    if (standardThresholdValue !== undefined) {
      ops.push(prisma.assignmentConfig.upsert({
        where: { key: 'standard_threshold_value' },
        create: { key: 'standard_threshold_value', value: standardThresholdValue },
        update: { value: standardThresholdValue },
      }));
    }
    await Promise.all(ops);
    res.json({ message: 'Assignment config updated' });
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

// ── POST /api/admin/jobs/trigger — run a background job immediately ────────────
adminRouter.post('/jobs/trigger', async (req, res) => {
  try {
    const { job } = req.body as { job?: string };

    if (job === 'sla-check') {
      const result = await runSLACheck();
      res.json({ job: 'sla-check', ...result });
      return;
    }

    if (job === 'midnight-overdue') {
      const result = await runMidnightCheck();
      res.json({ job: 'midnight-overdue', ...result });
      return;
    }

    if (job === 'performance-recalc') {
      const result = await runPerformanceRecalc();
      res.json({ job: 'performance-recalc', ...result });
      return;
    }

    res.status(400).json({ error: `Unknown job "${job}". Valid: sla-check, midnight-overdue, performance-recalc` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
