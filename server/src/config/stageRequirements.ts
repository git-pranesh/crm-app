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
  | { type: 'pdObChecklist'; label: string }
  | { type: 'obObmChecklist'; label: string }
  /**
   * File gate: a LeadFile with the given fileType must exist in one of the
   * listed stages. For FLOOR_PLAN the legacy `floorPlanUrl` field on the lead
   * is also accepted as a fallback so existing leads are not broken.
   */
  | { type: 'file'; fileType: string; stages: string[]; label: string };

export const STAGE_REQUIREMENTS: Record<string, StageRequirement[]> = {
  /**
   * MQL → DQL: all key facts (except Offer and Floor Plan) must be filled —
   * this absorbs the old EFFECTIVE_LEAD→MQL data-quality gate now that EL is
   * off-funnel — plus the DQL meeting + floor plan requirements that already
   * gated this step.
   */
  'MQL->DQL': [
    { type: 'field', field: 'estimatedValue', label: 'Client budget' },
    { type: 'field', field: 'projectType', label: 'Project type' },
    { type: 'field', field: 'source', label: 'Lead source' },
    { type: 'field', field: 'location', label: 'Location' },
    { type: 'field', field: 'builder', label: 'Builder (or N/A)' },
    { type: 'field', field: 'scope', label: 'Scope of work' },
    { type: 'field', field: 'expectedMoveIn', label: 'Expected move-in date' },
    { type: 'meeting', meetingType: 'DQL', label: 'Scheduled DQL meeting' },
    /**
     * Floor plan accepted from the legacy EL folder (old data), MQL folder,
     * or the legacy floorPlanUrl field (backward-compatible).
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
  'PROPOSAL_PRESENTED->PROPOSAL_DISCUSSION': [
    { type: 'quote', label: 'Generated quote' },
  ],
  /**
   * Proposal Discussion → Onboarding is gated on the PD→OB checklist
   * (payment screenshot, payment/project value, OB Quote, OB meeting
   * scheduled, welcome mail sent). The checklist's "send welcome mail"
   * action performs this transition directly, so in practice this gate is
   * only reachable once that action has already run — see
   * routes/pdObChecklist.ts.
   */
  'PROPOSAL_DISCUSSION->ONBOARDING': [
    { type: 'pdObChecklist', label: 'Completed PD→OB checklist (welcome mail sent)' },
  ],
  /**
   * Onboarding → Onboarding Meeting is gated on the generated quote document
   * plus the OB→OBM checklist (7 welcome-document items + NPS trigger). Its
   * "send OBM mail" action performs this transition directly — see
   * routes/obObmChecklist.ts.
   */
  'ONBOARDING->ONBOARDING_MEETING': [
    { type: 'file', fileType: 'GENERATED_QUOTE', stages: ['ONBOARDING'], label: 'Generated quote document (Files → OB)' },
    { type: 'obObmChecklist', label: 'Completed OB→OBM checklist (OBM mail sent)' },
  ],
  'ONBOARDING_MEETING->DESIGN_IN_PROGRESS': [
    { type: 'dip', label: 'Completed DIP checklist' },
  ],
};

/**
 * DQL → PROPOSAL_PRESENTED (direct skip of Proposal Ready) — the only stage
 * in the funnel that may be skipped. Skipping a stage must never skip its
 * gate: this accumulates the full MQL→DQL→PROPOSAL_READY→PROPOSAL_PRESENTED
 * requirement set (data-quality fields, DQL meeting, floor plan, lifestyle
 * capture, PP meeting, pitch presentation) so a lead can't reach Proposal
 * Presented with less verification than the normal step-by-step path.
 * Defined after STAGE_REQUIREMENTS (and merged onto it below) so it can
 * reference the other legs without duplicating them by hand.
 */
STAGE_REQUIREMENTS['DQL->PROPOSAL_PRESENTED'] = [
  ...STAGE_REQUIREMENTS['MQL->DQL'],
  ...STAGE_REQUIREMENTS['DQL->PROPOSAL_READY'],
  ...STAGE_REQUIREMENTS['PROPOSAL_READY->PROPOSAL_PRESENTED'],
];

/**
 * Linear funnel order. Used to expand a forward stage jump into the set of
 * intermediate adjacent transitions whose requirements must all be satisfied.
 * Stages not listed here (EFFECTIVE_LEAD, HANDED_OVER, INACTIVE, ON_HOLD) are
 * legacy/off-funnel and ungated.
 */
export const FUNNEL_ORDER = [
  'MQL',
  'DQL',
  'PROPOSAL_READY',
  'PROPOSAL_PRESENTED',
  'PROPOSAL_DISCUSSION',
  'ONBOARDING',
  'ONBOARDING_MEETING',
  'DESIGN_IN_PROGRESS',
] as const;

/**
 * Forward jumps besides plain adjacent steps that are explicitly allowed to
 * skip a stage. DQL is the only stage in the funnel that may be skipped
 * (directly to Proposal Presented); every other forward move must go one
 * step at a time even if the accumulated gate would technically be satisfied.
 */
const ALLOWED_SKIP_TRANSITIONS = new Set<string>(['DQL->PROPOSAL_PRESENTED']);

/**
 * Whether a stage change from `fromStage` to `toStage` is structurally
 * permitted at all (independent of whether its gate requirements are met).
 * Backward moves within the active funnel are left to the caller's own
 * backward-move restriction. Legacy stages (EFFECTIVE_LEAD, HANDED_OVER) are
 * off-funnel for *new* transitions, not an unrestricted bypass of it:
 *   - EFFECTIVE_LEAD may only move forward into MQL (the funnel's real
 *     starting point) — it can't be used to jump straight into DQL/PP/etc.
 *   - HANDED_OVER can never be entered going forward now that
 *     DESIGN_IN_PROGRESS is the funnel's terminal/incentive stage; it only
 *     exists on pre-restructure leads.
 * This only blocks illegal forward skips/entries — off-funnel side moves
 * (INACTIVE, ON_HOLD) and true backward moves are handled by the caller.
 */
export function isStageJumpAllowed(fromStage: string, toStage: string): boolean {
  if (toStage === 'HANDED_OVER') return false;

  const toIdx = FUNNEL_ORDER.indexOf(toStage as (typeof FUNNEL_ORDER)[number]);

  // EFFECTIVE_LEAD is legacy/off-funnel (not in FUNNEL_ORDER), so it's handled
  // by two explicit, symmetric rules rather than the index arithmetic below:
  //   - Moving OUT of EL into an active funnel stage may only land on MQL
  //     (the funnel's real starting point) — this does NOT restrict EL's
  //     side moves (ON_HOLD/INACTIVE), which aren't in FUNNEL_ORDER either
  //     and so fall through to the "unrestricted off-funnel" branch below.
  //   - Moving INTO EL is only ever the explicit MQL → EL rollback; every
  //     other stage (DQL and beyond) is blocked from demoting back to EL,
  //     matching the "only MQL → Effective Lead" rule enforced in leads.ts.
  if (fromStage === 'EFFECTIVE_LEAD' && toIdx !== -1) return toStage === 'MQL';
  if (toStage === 'EFFECTIVE_LEAD') return fromStage === 'MQL';

  const fromIdx = FUNNEL_ORDER.indexOf(fromStage as (typeof FUNNEL_ORDER)[number]);
  if (fromIdx === -1 || toIdx === -1) return true; // other legacy/off-funnel — unrestricted
  if (toIdx <= fromIdx) return true; // backward/no-op — handled elsewhere
  if (toIdx === fromIdx + 1) return true; // adjacent forward step always fine
  return ALLOWED_SKIP_TRANSITIONS.has(`${fromStage}->${toStage}`);
}

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
      case 'pdObChecklist': {
        const c = await prisma.pDOBChecklist.findUnique({
          where: { leadId: lead.id },
          select: { completedAt: true },
        });
        satisfied = !!c?.completedAt;
        break;
      }
      case 'obObmChecklist': {
        const c = await prisma.oBOBMChecklist.findUnique({
          where: { leadId: lead.id },
          select: { completedAt: true },
        });
        satisfied = !!c?.completedAt;
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
