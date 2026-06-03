import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';

export const discountsRouter = Router();
export const leadDiscountRouter = Router({ mergeParams: true });

const discountInclude = {
  lead: { select: { id: true, leadId: true, name: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  reviewedBy: { select: { id: true, name: true } },
} as const;

// ── POST /api/leads/:leadId/discount-request ──────────────────────────────────
leadDiscountRouter.post('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;

  const { originalAmount, requestedAmount, discountPct, reason } = req.body as {
    originalAmount?: number; requestedAmount?: number; discountPct?: number; reason?: string;
  };

  if (!originalAmount || !requestedAmount || !reason) {
    res.status(400).json({ error: 'originalAmount, requestedAmount, and reason are required' });
    return;
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

  // Check for existing pending request
  const existing = await prisma.discountRequest.findFirst({
    where: { leadId, status: 'PENDING' },
  });
  if (existing) {
    res.status(409).json({ error: 'A pending discount request already exists for this lead' });
    return;
  }

  const computed = discountPct ?? +(((originalAmount - requestedAmount) / originalAmount) * 100).toFixed(2);

  const request = await prisma.discountRequest.create({
    data: {
      leadId,
      requestedById: user.id,
      originalAmount,
      requestedAmount,
      discountPct: computed,
      reason,
      status: 'PENDING',
    },
    include: discountInclude,
  });

  await logActivity(user.id, 'DISCOUNT_REQUESTED', leadId, { discountPct: computed, reason });

  // Notify BL
  if (lead.assignedBLId) {
    await createNotification(
      lead.assignedBLId,
      'DISCOUNT_REQUEST',
      `${user.name} raised a discount request for lead ${lead.leadId} (${lead.name}): ${computed.toFixed(1)}% off`,
      leadId,
    );
  }

  res.status(201).json({ request });
});

// ── GET /api/discount-requests/pending — BL sees team requests ────────────────
discountsRouter.get('/pending', verifyToken, requireRole('BL', 'BRANCH_HEAD'), async (req, res) => {
  const user = req.user!;
  let leadFilter: any = {};

  if (user.role === 'BL') {
    const members = await prisma.user.findMany({
      where: { blId: user.id },
      select: { id: true },
    });
    leadFilter = { assignedDesignerId: { in: members.map((m) => m.id) } };
  }

  const requests = await prisma.discountRequest.findMany({
    where: { status: 'PENDING', lead: leadFilter },
    include: discountInclude,
    orderBy: { createdAt: 'desc' },
  });

  res.json({ requests });
});

// ── GET /api/discount-requests — all requests (filterable) ───────────────────
discountsRouter.get('/', verifyToken, async (req, res) => {
  const { status, leadId } = req.query as { status?: string; leadId?: string };
  const where: any = {};
  if (status) where.status = status;
  if (leadId) where.leadId = leadId;

  const requests = await prisma.discountRequest.findMany({
    where,
    include: discountInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({ requests });
});

// ── PATCH /api/discount-requests/:id — BL approves or rejects ────────────────
discountsRouter.patch('/:id', verifyToken, requireRole('BL', 'BRANCH_HEAD'), async (req, res) => {
  const { id } = req.params;
  const user = req.user!;
  const { status, reviewerComment } = req.body as {
    status?: string; reviewerComment?: string;
  };

  if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
    res.status(400).json({ error: 'status must be APPROVED or REJECTED' });
    return;
  }
  if (status === 'REJECTED' && !reviewerComment?.trim()) {
    res.status(400).json({ error: 'reviewerComment is mandatory when rejecting' });
    return;
  }

  const existing = await prisma.discountRequest.findUnique({
    where: { id },
    include: { lead: { select: { id: true, leadId: true, name: true } }, requestedBy: true },
  });
  if (!existing) { res.status(404).json({ error: 'Discount request not found' }); return; }
  if (existing.status !== 'PENDING') {
    res.status(409).json({ error: 'Request is no longer pending' });
    return;
  }

  const updated = await prisma.discountRequest.update({
    where: { id },
    data: { status: status as any, reviewedById: user.id, reviewerComment },
    include: discountInclude,
  });

  await logActivity(user.id, `DISCOUNT_${status}`, existing.lead.id, {
    requestId: id,
    discountPct: existing.discountPct,
    reviewerComment,
  });

  // Notify the designer who raised the request
  await createNotification(
    existing.requestedById,
    'DISCOUNT_REQUEST',
    `Your discount request for lead ${existing.lead.leadId} (${existing.lead.name}) was ${status.toLowerCase()} by ${user.name}.${reviewerComment ? ` Note: ${reviewerComment}` : ''}`,
    existing.lead.id,
  );

  res.json({ request: updated });
});
