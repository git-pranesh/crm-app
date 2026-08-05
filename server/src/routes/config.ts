import { Router } from 'express';
import { verifyToken } from '../middleware/auth.js';
import {
  SALES_STAGE_SLA,
  DESIGN_PHASES,
  DESIGN_PHASE_DEFAULT_DAYS,
  DESIGN_OVERALL_SLA_DAYS,
} from '../config/slaConfig.js';

export const configRouter = Router();

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
