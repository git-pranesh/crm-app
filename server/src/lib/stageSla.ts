import { prisma } from './prisma.js';
import { computeStageSlaStatus, daysBetween, type SlaStatus } from '../config/slaConfig.js';

interface StageChangeMeta {
  from?: string;
  to?: string;
}

/**
 * Derive when a lead entered its CURRENT stage from its STAGE_CHANGED
 * activity log, walking chronologically forward. Falls back to the lead's
 * createdAt if it has never changed stage. Mirrors the reconstruction logic
 * used by GET /api/leads/:id/stage-history.
 */
function deriveCurrentStageEnteredAt(
  logs: { createdAt: Date; meta: unknown }[],
  leadCreatedAt: Date,
): Date {
  let enteredAt = leadCreatedAt;
  for (const log of logs) {
    const meta = log.meta as StageChangeMeta | null;
    if (meta?.to) enteredAt = log.createdAt;
  }
  return enteredAt;
}

export interface LeadSlaInfo {
  daysInCurrentStage: number;
  slaStatus: SlaStatus;
}

/**
 * Batch-compute `daysInCurrentStage` + `slaStatus` for a set of leads.
 * Returns a map keyed by lead id.
 */
export async function computeSlaInfoForLeads(
  leads: { id: string; stage: string; createdAt: Date }[],
): Promise<Record<string, LeadSlaInfo>> {
  const result: Record<string, LeadSlaInfo> = {};
  if (leads.length === 0) return result;

  const leadIds = leads.map((l) => l.id);
  const logs = await prisma.activityLog.findMany({
    where: { leadId: { in: leadIds }, action: 'STAGE_CHANGED' },
    orderBy: { createdAt: 'asc' },
    select: { leadId: true, createdAt: true, meta: true },
  });

  const logsByLead = new Map<string, { createdAt: Date; meta: unknown }[]>();
  for (const log of logs) {
    if (!log.leadId) continue;
    if (!logsByLead.has(log.leadId)) logsByLead.set(log.leadId, []);
    logsByLead.get(log.leadId)!.push({ createdAt: log.createdAt, meta: log.meta });
  }

  const now = new Date();
  for (const lead of leads) {
    const enteredAt = deriveCurrentStageEnteredAt(logsByLead.get(lead.id) ?? [], lead.createdAt);
    const daysInCurrentStage = daysBetween(enteredAt, now);
    result[lead.id] = {
      daysInCurrentStage,
      slaStatus: computeStageSlaStatus(lead.stage, daysInCurrentStage),
    };
  }
  return result;
}

/** Convenience single-lead variant for detail endpoints. */
export async function computeSlaInfoForLead(lead: { id: string; stage: string; createdAt: Date }): Promise<LeadSlaInfo> {
  const map = await computeSlaInfoForLeads([lead]);
  return map[lead.id];
}
