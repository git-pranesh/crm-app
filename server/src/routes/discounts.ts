import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';

export const discountsRouter = Router();
export const leadDiscountRouter = Router({ mergeParams: true });

// Discount authority ceilings (G7)
const AUTHORITY_CEILING: Record<string, number> = {
  DESIGNER: 10,
  CRE: 10,
  BL: 15,
  BRANCH_HEAD: 100,
};

const discountInclude = {
  lead: { select: { id: true, leadId: true, name: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  reviewedBy: { select: { id: true, name: true } },
  forwardedBy: { select: { id: true, name: true } },
} as const;

// ── POST /api/leads/:leadId/discount-request ──────────────────────────────────
leadDiscountRouter.post('/', verifyToken, async (req, res) => {
  try {
    const { leadId } = req.params as { leadId: string };
    const user = req.user!;

    const { originalAmount, amount, discountPct, reason, woodworkValueExGst, totalValueExGst, quoteLink } = req.body as {
      originalAmount?: number; amount?: number; discountPct?: number; reason?: string;
      woodworkValueExGst?: number; totalValueExGst?: number; quoteLink?: string;
    };

    if (!originalAmount || !amount || !reason) {
      res.status(400).json({ error: 'originalAmount, amount, and reason are required' });
      return;
    }
    if (!woodworkValueExGst || !totalValueExGst) {
      res.status(400).json({ error: 'Woodwork value (ex-GST) and total project value (ex-GST) are required' });
      return;
    }
    if (
      typeof originalAmount !== 'number' || typeof amount !== 'number' ||
      typeof woodworkValueExGst !== 'number' || typeof totalValueExGst !== 'number' ||
      originalAmount <= 0 || amount <= 0 || woodworkValueExGst <= 0 || totalValueExGst <= 0 ||
      amount >= originalAmount
    ) {
      res.status(400).json({ error: 'Amounts must be positive numbers and the discounted amount must be less than the original amount' });
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

    // Canonical discount % is always derived server-side from the amounts —
    // never trust client-supplied discountPct (approval thresholds depend on it).
    const computed = +(((originalAmount - amount) / originalAmount) * 100).toFixed(2);
    if (discountPct != null && Math.abs(discountPct - computed) > 0.1) {
      res.status(400).json({ error: 'discountPct does not match the provided amounts' });
      return;
    }

    const request = await prisma.discountRequest.create({
      data: {
        leadId,
        requestedById: user.id,
        originalAmount,
        amount,
        discountPct: computed,
        reason,
        woodworkValueExGst,
        totalValueExGst,
        quoteLink: quoteLink?.trim() || null,
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/discount-requests/pending — BL sees team; BH sees forwarded + >15% ─
discountsRouter.get('/pending', verifyToken, requireRole('BL', 'BRANCH_HEAD'), async (req, res) => {
  try {
    const user = req.user!;
    let where: any = { status: 'PENDING' };

    if (user.role === 'BL') {
      const members = await prisma.user.findMany({
        where: { blId: user.id },
        select: { id: true },
      });
      where.lead = { assignedDesignerId: { in: members.map((m) => m.id) } };
    } else {
      // BRANCH_HEAD: show all forwarded OR discountPct > 15
      where.OR = [
        { forwardedToRole: 'BRANCH_HEAD' },
        { discountPct: { gt: 15 } },
      ];
    }

    const requests = await prisma.discountRequest.findMany({
      where,
      include: discountInclude,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ requests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/discount-requests — all requests (filterable) ───────────────────
discountsRouter.get('/', verifyToken, async (req, res) => {
  try {
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/discount-requests/:id/forward — BL forwards >15% to BH ────────
discountsRouter.patch('/:id/forward', verifyToken, requireRole('BL'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user!;

    const existing = await prisma.discountRequest.findUnique({
      where: { id },
      include: {
        lead: { select: { id: true, leadId: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });
    if (!existing) { res.status(404).json({ error: 'Discount request not found' }); return; }
    if (existing.status !== 'PENDING') {
      res.status(409).json({ error: 'Request is no longer pending' });
      return;
    }
    if (Number(existing.discountPct) <= 15) {
      res.status(400).json({ error: 'Forward is only required for discount > 15%; you can approve this directly.' });
      return;
    }
    if (existing.forwardedToRole) {
      res.status(409).json({ error: 'Already forwarded to Branch Head' });
      return;
    }

    const updated = await prisma.discountRequest.update({
      where: { id },
      data: {
        forwardedToRole: 'BRANCH_HEAD',
        forwardedById: user.id,
      },
      include: discountInclude,
    });

    await logActivity(user.id, 'DISCOUNT_FORWARDED', existing.lead.id, {
      requestId: id, discountPct: Number(existing.discountPct),
    });

    // Notify all BRANCH_HEAD users
    const branchHeads = await prisma.user.findMany({
      where: { role: 'BRANCH_HEAD', isActive: true },
      select: { id: true },
    });
    for (const bh of branchHeads) {
      await createNotification(
        bh.id,
        'DISCOUNT_REQUEST',
        `${user.name} forwarded a ${Number(existing.discountPct).toFixed(1)}% discount request for lead ${existing.lead.leadId} (${existing.lead.name}) — requires Branch Head approval`,
        existing.lead.id,
      );
    }

    res.json({ request: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/discount-requests/:id — approve or reject (with ceiling check) ─
discountsRouter.patch('/:id', verifyToken, requireRole('BL', 'BRANCH_HEAD'), async (req, res) => {
  try {
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
      include: {
        lead: { select: { id: true, leadId: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
      },
    });
    if (!existing) { res.status(404).json({ error: 'Discount request not found' }); return; }
    if (existing.status !== 'PENDING') {
      res.status(409).json({ error: 'Request is no longer pending' });
      return;
    }

    // G7: Enforce discount ceiling per role
    const discountPctNum = Number(existing.discountPct);
    const ceiling = AUTHORITY_CEILING[user.role] ?? 0;
    if (status === 'APPROVED' && discountPctNum > ceiling) {
      res.status(403).json({
        error: `Exceeds your approval authority (max ${ceiling}% for ${user.role}). Use /forward to escalate to Branch Head.`,
      });
      return;
    }

    const updated = await prisma.discountRequest.update({
      where: { id },
      data: {
        status: status as any,
        reviewedById: user.id,
        reviewerComment,
        reviewedAt: new Date(),
      },
      include: discountInclude,
    });

    await logActivity(user.id, `DISCOUNT_${status}`, existing.lead.id, {
      requestId: id,
      discountPct: discountPctNum,
      reviewerComment,
    });

    // Notify the designer who raised the request
    const notifyMsg =
      `Your discount request for lead ${existing.lead.leadId} (${existing.lead.name}) was ${status.toLowerCase()} by ${user.name}.${reviewerComment ? ` Note: ${reviewerComment}` : ''}`;

    const notifyIds = new Set<string>([existing.requestedById]);

    // Also notify forwarding BL if different from reviewer
    if (existing.forwardedById && existing.forwardedById !== user.id) {
      notifyIds.add(existing.forwardedById);
    }

    await Promise.all(
      Array.from(notifyIds).map((uid) =>
        createNotification(uid, 'DISCOUNT_REQUEST', notifyMsg, existing.lead.id),
      ),
    );

    res.json({ request: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
