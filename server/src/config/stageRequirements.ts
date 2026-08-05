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
  | { type: 'dip'; label: string }
  /**
   * File gate: a LeadFile with the given fileType must exist in one of the
   * listed stages. For FLOOR_PLAN the legacy `floorPlanUrl` field on the lead
   * is also accepted as a fallback so existing leads are not broken.
   */
  | { type: 'file'; fileType: string; stages: string[]; label: string };

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
    /**
     * Floor plan accepted from either EL or MQL stage folder, or the legacy
     * floorPlanUrl field (backward-compatible).
     */
    { type: 'file', fileType: 'FLOOR_PLAN', stages: ['EFFECTIVE_LEAD', 'MQL'], label: 'Floor plan uploaded (Files tab)' },
  ],
  'DQL->PROPOSAL_READY': [
    { type: 'file', fileType: 'FLOOR_PLAN', stages: ['EFFECTIVE_LEAD', 'MQL', 'DQL'], label: 'Floor plan' },
    { type: 'file', fileType: 'LIFESTYLE_CAPTURE', stages: ['DQL'], label: 'Lifestyle capture sheet (Files → DQL)' },
  ],
  'PROPOSAL_READY->PROPOSAL_PRESENTED': [
    { type: 'meeting', meetingType: 'PP', label: 'Scheduled proposal presentation (PP) meeting' },
    { type: 'file', fileType: 'PITCH_PRESENTATION', stages: ['PROPOSAL_READY'], label: 'Pitch presentation (Files → PR)' },
  ],
  /**
   * A generated quote (created via the Quote Builder callback, which inserts
   * a Quote row for the lead) is the single source of truth here. There is
   * no separate manually-uploaded "QUOTATION" file gate: the Quote Builder
   * callback has no way to attach a real file, so requiring a LeadFile here
   * used to permanently block leads that had a real, system-generated quote.
   * The Quotation file type can still be uploaded voluntarily from the Files
   * tab, but it is no longer mandatory for this transition.
   */
  'PROPOSAL_PRESENTED->ONBOARDING': [
    { type: 'quote', label: 'Generated quote' },
  ],
  'ONBOARDING->HANDED_OVER': [
    { type: 'dip', label: 'Completed DIP checklist' },
    { type: 'file', fileType: 'GENERATED_QUOTE', stages: ['ONBOARDING'], label: 'Generated quote document (Files → OB)' },
  ],
  /**
   * DQL → PROPOSAL_PRESENTED (direct skip of Proposal Ready).
   * Requires floor plan + lifestyle capture + PP meeting + pitch presentation.
   */
  'DQL->PROPOSAL_PRESENTED': [
    { type: 'file', fileType: 'FLOOR_PLAN', stages: ['EFFECTIVE_LEAD', 'MQL', 'DQL'], label: 'Floor plan' },
    { type: 'file', fileType: 'LIFESTYLE_CAPTURE', stages: ['DQL'], label: 'Lifestyle capture sheet (Files → DQL)' },
    { type: 'meeting', meetingType: 'PP', label: 'Scheduled proposal presentation (PP) meeting' },
    { type: 'file', fileType: 'PITCH_PRESENTATION', stages: ['PROPOSAL_READY', 'DQL'], label: 'Pitch presentation (Files → DQL or PR)' },
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
  // An explicit STAGE_REQUIREMENTS entry always takes precedence. This allows
  // special-cased transitions (e.g. DQL→PROPOSAL_PRESENTED direct skip) to
  // override the default accumulation logic.
  const explicit = STAGE_REQUIREMENTS[`${fromStage}->${toStage}`];
  if (explicit !== undefined) return explicit;

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

  return [];
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
  /** Per-requirement satisfaction, in the same order as configured, so UI can show which specific items are met vs. missing. */
  details: { label: string; satisfied: boolean }[];
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
  const details: { label: string; satisfied: boolean }[] = [];

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
      case 'file': {
        const fileRecord = await prisma.leadFile.findFirst({
          where: {
            leadId: lead.id,
            fileType: r.fileType as any,
            ...(r.stages?.length ? { stage: { in: r.stages as any } } : {}),
          },
          select: { id: true },
        });
        satisfied = !!fileRecord;
        // Backward-compat: floor plan field on the lead also satisfies FLOOR_PLAN check
        if (!satisfied && r.fileType === 'FLOOR_PLAN') {
          satisfied = hasValue(lead.floorPlanUrl);
        }
        break;
      }
    }
    if (!satisfied) missing.push(r.label);
    details.push({ label: r.label, satisfied });
  }

  // Global rule: a lead with 1-star intent cannot advance forward in the funnel.
  // This applies to ALL forward moves regardless of which transition.
  if (isForwardFunnelMove && lead.intentRating === 1) {
    const label = 'Intent rating is 1★ (no action planned) — update the lead\'s intent rating before advancing';
    missing.push(label);
    details.push({ label, satisfied: false });
  }

  return { ok: missing.length === 0, missing, details };
}
