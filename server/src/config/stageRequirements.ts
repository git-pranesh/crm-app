import { prisma } from '../lib/prisma.js';

/**
 * Single source of truth for mandatory fields/actions required to move a lead
 * from one stage to another. Edit this object to adjust gating rules later.
 *
 * Key format: `${fromStage}->${toStage}` for adjacent funnel steps. Forward
 * jumps that skip stages are gated by accumulating the requirements of every
 * intermediate step (see FUNNEL_ORDER), so a lead can never bypass a gate by
 * leaping ahead. Backward moves and off-funnel stages (INACTIVE, ON_HOLD) are
 * unrestricted.
 */
export type StageRequirement =
  | {
      type: 'field';
      field:
        | 'intentRating'
        | 'estimatedValue'
        | 'floorPlanUrl'
        | 'nextMeetingDate'
        | 'projectType'
        | 'source'
        | 'location'
        | 'builder'
        | 'scope'
        | 'expectedMoveIn';
      label: string;
    }
  | { type: 'meeting'; meetingType: 'DQL' | 'PP'; label: string }
  | { type: 'quote'; label: string }
  | { type: 'dip'; label: string };

export const STAGE_REQUIREMENTS: Record<string, StageRequirement[]> = {
  /**
   * EL → MQL: all key facts (except Offer and Floor Plan) must be filled.
   * Intent rating of 1 is separately blocked in checkStageRequirements.
   */
  'EFFECTIVE_LEAD->MQL': [
    { type: 'field', field: 'estimatedValue', label: 'Client budget' },
    { type: 'field', field: 'projectType', label: 'Project type' },
    { type: 'field', field: 'source', label: 'Lead source' },
    { type: 'field', field: 'location', label: 'Location' },
    { type: 'field', field: 'builder', label: 'Builder (or N/A)' },
    { type: 'field', field: 'scope', label: 'Scope of work' },
    { type: 'field', field: 'expectedMoveIn', label: 'Expected move-in date' },
  ],
  'MQL->DQL': [
    { type: 'meeting', meetingType: 'DQL', label: 'Scheduled DQL meeting' },
  ],
  'DQL->PROPOSAL_READY': [
    { type: 'field', field: 'floorPlanUrl', label: 'Floor plan' },
  ],
  'PROPOSAL_READY->PROPOSAL_PRESENTED': [
    { type: 'meeting', meetingType: 'PP', label: 'Scheduled proposal presentation (PP) meeting' },
  ],
  'PROPOSAL_PRESENTED->ONBOARDING': [
    { type: 'quote', label: 'Generated quote' },
  ],
  'ONBOARDING->HANDED_OVER': [
    { type: 'dip', label: 'Completed DIP checklist' },
  ],
};

/**
 * Linear funnel order. Used to expand a forward stage jump into the set of
 * intermediate adjacent transitions whose requirements must all be satisfied.
 * Stages not listed here (INACTIVE, ON_HOLD) are off-funnel and ungated.
 */
export const FUNNEL_ORDER = [
  'EFFECTIVE_LEAD',
  'MQL',
  'DQL',
  'PROPOSAL_READY',
  'PROPOSAL_PRESENTED',
  'ONBOARDING',
  'HANDED_OVER',
] as const;

/**
 * Collect all requirements that apply when moving from `fromStage` to
 * `toStage`. For forward moves along the funnel this accumulates every
 * intermediate step's requirements so jumps cannot bypass a gate. Backward
 * moves and off-funnel stages return any directly-configured requirements
 * (currently none), i.e. they are ungated.
 */
function requirementsForTransition(fromStage: string, toStage: string): StageRequirement[] {
  const fromIdx = FUNNEL_ORDER.indexOf(fromStage as (typeof FUNNEL_ORDER)[number]);
  const toIdx = FUNNEL_ORDER.indexOf(toStage as (typeof FUNNEL_ORDER)[number]);

  if (fromIdx !== -1 && toIdx !== -1 && toIdx > fromIdx) {
    const reqs: StageRequirement[] = [];
    for (let i = fromIdx; i < toIdx; i++) {
      const stepReqs = STAGE_REQUIREMENTS[`${FUNNEL_ORDER[i]}->${FUNNEL_ORDER[i + 1]}`];
      if (stepReqs) reqs.push(...stepReqs);
    }
    return reqs;
  }

  return STAGE_REQUIREMENTS[`${fromStage}->${toStage}`] ?? [];
}

const ACTIVE_MEETING_STATUSES = ['SCHEDULED', 'RESCHEDULED', 'COMPLETED'] as const;

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

export interface StageCheckResult {
  ok: boolean;
  missing: string[];
}

/**
 * Evaluate whether a lead satisfies the requirements for a stage transition.
 * `lead` must include `id` and should reflect any field changes being applied
 * in the same request (so a user can set a required field and change stage in
 * one update).
 */
export async function checkStageRequirements(
  lead: Record<string, any>,
  fromStage: string,
  toStage: string,
): Promise<StageCheckResult> {
  const fromIdx = FUNNEL_ORDER.indexOf(fromStage as (typeof FUNNEL_ORDER)[number]);
  const toIdx = FUNNEL_ORDER.indexOf(toStage as (typeof FUNNEL_ORDER)[number]);
  const isForwardFunnelMove = fromIdx !== -1 && toIdx !== -1 && toIdx > fromIdx;

  const reqs = requirementsForTransition(fromStage, toStage);
  const missing: string[] = [];

  for (const r of reqs) {
    let satisfied = false;
    switch (r.type) {
      case 'field':
        satisfied = hasValue(lead[r.field]);
        break;
      case 'meeting': {
        const m = await prisma.meeting.findFirst({
          where: {
            leadId: lead.id,
            type: r.meetingType as any,
            status: { in: ACTIVE_MEETING_STATUSES as any },
          },
          select: { id: true },
        });
        satisfied = !!m;
        break;
      }
      case 'quote': {
        const q = await prisma.quote.findFirst({ where: { leadId: lead.id }, select: { id: true } });
        satisfied = !!q;
        break;
      }
      case 'dip': {
        const dip = await prisma.dIPChecklist.findUnique({
          where: { leadId: lead.id },
          select: { completedAt: true },
        });
        satisfied = !!dip?.completedAt;
        break;
      }
    }
    if (!satisfied) missing.push(r.label);
  }

  // Global rule: a lead with 1-star intent cannot advance forward in the funnel.
  // This applies to ALL forward moves regardless of which transition.
  if (isForwardFunnelMove && lead.intentRating === 1) {
    missing.push(
      'Intent rating is 1★ (no action planned) — update the lead\'s intent rating before advancing',
    );
  }

  return { ok: missing.length === 0, missing };
}
