import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import {
  SALES_STAGE_SLA,
  DESIGN_PHASES,
  DESIGN_PHASE_DEFAULT_DAYS,
  DESIGN_OVERALL_SLA_DAYS,
} from '../config/slaConfig.js';

export const configRouter = Router();

// ── GET /api/config/offers — active offer options for lead offer dropdowns ────
// Task #75: replaces the old free-text Offer 1/2/3 lead fields with an
// admin-managed list (see /api/admin/offer-options for CRUD).
configRouter.get('/offers', verifyToken, async (_req, res) => {
  try {
    const offers = await prisma.offerOption.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      select: { id: true, label: true },
    });
    res.json({ offers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/config/sla — SLA thresholds shared by client + server ────────────
// Single source of truth (task #56): the client must consume these values
// rather than hardcoding its own copies of the day thresholds.
configRouter.get('/sla', verifyToken, (_req, res) => {
  res.json({
    salesStageThresholds: SALES_STAGE_SLA,
    designPhases: DESIGN_PHASES.map((p) => ({ key: p.key, label: p.label })),
    designPhaseDefaultDays: DESIGN_PHASE_DEFAULT_DAYS,
    designOverallSlaDays: DESIGN_OVERALL_SLA_DAYS,
  });
});
