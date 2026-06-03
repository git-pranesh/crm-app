import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';

export const quotesRouter = Router();
export const usersDiscountRouter = Router({ mergeParams: true });

// Max discount per role (%)
const DISCOUNT_AUTHORITY: Record<string, number> = {
  DESIGNER: 5,
  CRE: 10,
  BL: 20,
  BRANCH_HEAD: 30,
};

// ── GET /api/users/:id/discount-authority ─────────────────────────────────────
// Called by the Quote Builder before allowing discount submission
usersDiscountRouter.get('/', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { role: true, name: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    res.json({ userId: req.params.id, role: user.role, maxDiscountPct: DISCOUNT_AUTHORITY[user.role] ?? 5 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/quotes/callback — Quote Builder posts back when quote created ───
quotesRouter.post('/callback', async (req, res) => {
  try {
    const { leadId: leadRef, amount, discountPct, quoteRef } = req.body as {
      leadId?: string; amount?: number; discountPct?: number; quoteRef?: string;
    };

    if (!leadRef || !amount) {
      res.status(400).json({ error: 'leadId and amount are required' });
      return;
    }

    // leadId can be X#### format or the UUID id
    const lead = await prisma.lead.findFirst({
      where: { OR: [{ leadId: leadRef }, { id: leadRef }] },
    });
    if (!lead) { res.status(404).json({ error: `Lead not found: ${leadRef}` }); return; }

    const quote = await prisma.quote.create({
      data: {
        leadId: lead.id,
        quoteBuilderRef: quoteRef,
        amount,
        discountPct: discountPct ?? 0,
        status: 'DRAFT',
      },
    });

    // Update lead estimated value
    await prisma.lead.update({
      where: { id: lead.id },
      data: { estimatedValue: amount },
    });

    const SYSTEM_USER_ID = process.env.SYSTEM_USER_ID;
    if (SYSTEM_USER_ID) {
      await logActivity(SYSTEM_USER_ID, 'QUOTE_RECEIVED', lead.id, {
        quoteRef, amount, discountPct,
      }).catch((e) => console.warn('[quotes:callback:activity]', e.message));
    }

    res.status(201).json({ quote, lead: { id: lead.id, leadId: lead.leadId } });
  } catch (err: any) {
    console.error('[quotes:callback]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:leadId/quotes — list quotes for a lead ───────────────────
quotesRouter.get('/lead/:leadId', verifyToken, async (req, res) => {
  try {
    const quotes = await prisma.quote.findMany({
      where: { leadId: req.params.leadId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ quotes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
