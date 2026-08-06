import { prisma } from '../lib/prisma.js';

/**
 * Single source of truth for mandatory fields/actions required to move a lead
 * from one stage to another. Edit this object to adjust gating rules later.
 *
 * Rebuilt for Task #83 to match the founder's 8-gate spec:
 *   1. EL→MQL           — project details mandatory (enforced at lead
 *                          creation, Task #82; no runtime gate needed here).
 *   2. MQL→DQL          — floor plan + DQL meeting (completed) + lifestyle
 *                          capture sheet + tentative project value.
 *   3. DQL→PR           — pitch-ready file uploaded + project value.
 *   4. PR→PP            — PP meeting (completed) + PP presentation attached +
 *                          project value + Expected OB date.
 *   5. PP→PD            — meeting OR call (completed) + PD quotation.
 *   6. PD→OB            — generated OB quote + final pitch presentation/PD
 *                          file + payment value + project value (excl.
 *                          furniture) + furniture value (itemised via the
 *                          PD→OB checklist, whose completion performs the
 *                          transition — see routes/pdObChecklist.ts).
 *   7. OB→OBM           — OBM meeting scheduled.
 *   8. OBM→DIP          — OBM meeting completed + OBM checklist completed.
 *
 * Key format: `${fromStage}->${toStage}` for adjacent funnel steps. Forward
 * jumps that skip stages are gated by accumulating the requirements of every
 * intermediate step (see FUNNEL_ORDER), so a lead can never bypass a gate by
 * leaping ahead — except the three explicitly-allowed skip transitions below,
 * which drop specific items the founder marked optional when skipped.
 * Backward moves and off-funnel stages are unrestricted.
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
        | 'expectedMoveIn'
        | 'expectedObDate';
      label: string;
    }
  /** A meeting of the given type must exist. `status` defaults to 'scheduled'
   * (any active status — SCHEDULED/RESCHEDULED/COMPLETED all count); pass
   * 'completed' to require the meeting be specifically marked COMPLETED. */
  | { type: 'meeting'; meetingType: 'DQL' | 'PP' | 'ONBOARDING'; status?: 'scheduled' | 'completed'; label: string }
  /** Satisfied by EITHER a completed meeting of the given type, OR any logged
   * Call for the lead (calls have no separate "scheduled" state — they are
   * logged after the fact, so any Call row counts as "completed"). */
  | { type: 'meetingOrCall'; meetingType: 'DQL' | 'PP' | 'ONBOARDING'; label: string }
  /**
   * A generated Quote (Quote Builder callback row) or an uploaded
   * QUOTATION/GENERATED_QUOTE file in one of the given stages. Accepting
   * either fixes the reported bug where uploading "the generated quotation"
   * as a file didn't satisfy a gate that only checked for a Quote db row.
   */
  | { type: 'quote'; stages: string[]; label: string }
  | { type: 'dip'; label: string }
  | { type: 'pdObChecklist'; label: string }
  | { type: 'obObmChecklist'; label: string }
  /**
   * File gate: a LeadFile with the given fileType must exist in one of the
   * listed stages. For FLOOR_PLAN the legacy `floorPlanUrl` field on the lead
   * is also accepted as a fallback so existing leads are not broken.
   */
  | { type: 'file'; fileType: string; stages: string[]; label: string }
  /** Satisfied if a LeadFile with ANY of the given fileTypes exists in one of the listed stages. */
  | { type: 'fileAnyOf'; fileTypes: string[]; stages: string[]; label: string };

export const STAGE_REQUIREMENTS: Record<string, StageRequirement[]> = {
  /**
   * Task #83 spec item 2 — MQL → DQL: floor plan, a completed DQL meeting,
   * the lifestyle capture sheet (moved here from DQL→PR per spec — it's
   * meant to be captured before the DQL meeting, not after), and a tentative
   * project value. Data-quality fields (project type, source, location,
   * builder, scope, possession date) are no longer re-checked here: Task #82
   * made them mandatory at lead creation, so by the time a lead exists they
   * are already filled in.
   */
  'MQL->DQL': [
    {
      type: 'file', fileType: 'FLOOR_PLAN', stages: ['EFFECTIVE_LEAD', 'MQL'],
      label: 'Floor plan uploaded (Files tab)',
    },
    { type: 'meeting', meetingType: 'DQL', status: 'completed', label: 'DQL meeting completed' },
    { type: 'file', fileType: 'LIFESTYLE_CAPTURE', stages: ['MQL'], label: 'Lifestyle capture sheet (Files → MQL)' },
    { type: 'field', field: 'estimatedValue', label: 'Tentative project value' },
  ],
  /** Task #83 spec item 3 — DQL → Proposal Ready: pitch-ready file + project value. */
  'DQL->PROPOSAL_READY': [
    { type: 'file', fileType: 'PITCH_PRESENTATION', stages: ['DQL'], label: 'Pitch-ready file uploaded (Files → DQL)' },
    { type: 'field', field: 'estimatedValue', label: 'Project value' },
  ],
  /**
   * Task #83 spec item 4 — Proposal Ready → Proposal Presented: a completed
   * PP meeting, the PP presentation attached (same file type as the
   * pitch-ready file, but scoped to the Proposal Ready folder so it's a
   * distinct upload from the DQL-stage one), project value, and the
   * Expected OB date (also exposed as a lead-list/pipeline filter).
   */
  'PROPOSAL_READY->PROPOSAL_PRESENTED': [
    { type: 'meeting', meetingType: 'PP', status: 'completed', label: 'PP meeting completed' },
    { type: 'file', fileType: 'PITCH_PRESENTATION', stages: ['PROPOSAL_READY'], label: 'PP presentation attached (Files → PR)' },
    { type: 'field', field: 'estimatedValue', label: 'Project value' },
    { type: 'field', field: 'expectedObDate', label: 'Expected OB date' },
  ],
  /**
   * Task #83 spec item 5 — Proposal Presented → Proposal Discussion: a
   * completed meeting OR a logged call, plus a PD quotation. The quotation
   * check accepts either a real Quote row (from the Quote Builder callback)
   * or an uploaded QUOTATION/GENERATED_QUOTE file — this is the fix for the
   * reported "uploaded the generated quotation but couldn't move stage" bug:
   * the gate previously only recognised a Quote db row, so a manually
   * uploaded quotation document never satisfied it.
   */
  'PROPOSAL_PRESENTED->PROPOSAL_DISCUSSION': [
    { type: 'meetingOrCall', meetingType: 'PP', label: 'Meeting or call scheduled & completed' },
    { type: 'quote', stages: ['PROPOSAL_PRESENTED'], label: 'PD quotation (generated quote or uploaded quotation file)' },
  ],
  /**
   * Task #83 spec item 6 — Proposal Discussion → Onboarding: generated OB
   * quote, final pitch presentation or PD file, payment value, project value
   * (excl. furniture), and furniture value. The PD→OB checklist's
   * "send welcome mail" action validates all of these itemised fields (plus
   * a couple of operational extras — payment screenshot, OB meeting
   * date/location, notes) and performs the transition directly — see
   * routes/pdObChecklist.ts. The `fileAnyOf` requirement below is an
   * independent, always-checked baseline for the "final pitch presentation
   * or PD file" item, which nothing previously enforced.
   */
  'PROPOSAL_DISCUSSION->ONBOARDING': [
    {
      type: 'fileAnyOf', fileTypes: ['PITCH_PRESENTATION', 'QUOTATION'], stages: ['PROPOSAL_DISCUSSION'],
      label: 'Final pitch presentation or PD file (Files → PD)',
    },
    { type: 'pdObChecklist', label: 'Completed PD→OB checklist (welcome mail sent)' },
  ],
  /**
   * Task #83 spec item 7 — Onboarding → Onboarding Meeting: the OBM meeting
   * must be scheduled. This is intentionally lighter than before — it used
   * to require the entire OB→OBM checklist (7 welcome-document items + NPS
   * trigger) just to enter the Onboarding Meeting stage, which is what item
   * 8 actually asks for on the *next* transition. In practice the guided
   * "Send OBM mail" action (routes/obObmChecklist.ts) still enforces its own,
   * stricter checklist before it will fire — this is only the generic
   * baseline gate used by direct stage changes and the can-advance precheck.
   */
  'ONBOARDING->ONBOARDING_MEETING': [
    { type: 'meeting', meetingType: 'ONBOARDING', status: 'scheduled', label: 'OBM meeting scheduled' },
  ],
  /**
   * Task #83 spec item 8 — Onboarding Meeting → Design in Progress: the OBM
   * meeting must be marked completed, and the OBM checklist (DIPChecklist —
   * welcome mail sent, discount approval form sent, NPS triggered, CX
   * approval received, internal mail thread completed) must be completed.
   */
  'ONBOARDING_MEETING->DESIGN_IN_PROGRESS': [
    { type: 'meeting', meetingType: 'ONBOARDING', status: 'completed', label: 'OBM meeting completed' },
    { type: 'dip', label: 'OBM checklist completed' },
  ],
};

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
 * skip a stage:
 *   - DQL → Proposal Presented (skips Proposal Ready)
 *   - MQL → Proposal Presented (skips both DQL and Proposal Ready)
 *   - Proposal Presented → Onboarding (skips Proposal Discussion)
 * Every other forward move must go one step at a time even if the
 * accumulated gate would technically be satisfied.
 */
const ALLOWED_SKIP_TRANSITIONS = new Set<string>([
  'DQL->PROPOSAL_PRESENTED',
  'MQL->PROPOSAL_PRESENTED',
  'PROPOSAL_PRESENTED->ONBOARDING',
]);

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

/** True when a requirement's label matches one of the founder's "becomes
 * optional when skipped" exclusions for a given skipped-over stage. */
function isExcludedWhenSkipping(req: StageRequirement, skippedStage: 'DQL' | 'PROPOSAL_READY'): boolean {
  if (skippedStage === 'DQL') {
    // "the DQL meeting" becomes optional when DQL itself is skipped over.
    return req.type === 'meeting' && req.meetingType === 'DQL';
  }
  // "the PR file" (pitch-ready file, uploaded during Proposal Ready) becomes
  // optional when Proposal Ready is skipped over.
  return req.type === 'file' && req.fileType === 'PITCH_PRESENTATION' && req.stages.includes('DQL');
}

/**
 * Collect all requirements that apply when moving from `fromStage` to
 * `toStage`. For forward moves along the funnel this accumulates every
 * intermediate step's requirements so jumps cannot bypass a gate — except
 * the three explicitly-allowed skip transitions, which drop the specific
 * items the founder marked optional for that skip (see
 * ALLOWED_SKIP_TRANSITIONS and isExcludedWhenSkipping). Backward moves and
 * off-funnel stages return any directly-configured requirements (currently
 * none), i.e. they are ungated.
 */
function requirementsForTransition(fromStage: string, toStage: string): StageRequirement[] {
  const key = `${fromStage}->${toStage}`;

  // Proposal Presented → Onboarding (skip Proposal Discussion): per spec this
  // must NOT require the PD quote or PD meeting/call — use only the PD→OB
  // leg's requirements, dropping the PP→PD leg entirely.
  if (key === 'PROPOSAL_PRESENTED->ONBOARDING') {
    return [...STAGE_REQUIREMENTS['PROPOSAL_DISCUSSION->ONBOARDING']];
  }

  // DQL → Proposal Presented (skip Proposal Ready): drop the PR file.
  if (key === 'DQL->PROPOSAL_PRESENTED') {
    return [
      ...STAGE_REQUIREMENTS['DQL->PROPOSAL_READY'].filter((r) => !isExcludedWhenSkipping(r, 'PROPOSAL_READY')),
      ...STAGE_REQUIREMENTS['PROPOSAL_READY->PROPOSAL_PRESENTED'],
    ];
  }

  // MQL → Proposal Presented (skip both DQL and Proposal Ready): drop the DQL
  // meeting and the PR file.
  if (key === 'MQL->PROPOSAL_PRESENTED') {
    return [
      ...STAGE_REQUIREMENTS['MQL->DQL'].filter((r) => !isExcludedWhenSkipping(r, 'DQL')),
      ...STAGE_REQUIREMENTS['DQL->PROPOSAL_READY'].filter((r) => !isExcludedWhenSkipping(r, 'PROPOSAL_READY')),
      ...STAGE_REQUIREMENTS['PROPOSAL_READY->PROPOSAL_PRESENTED'],
    ];
  }

  // An explicit STAGE_REQUIREMENTS entry always takes precedence for anything
  // else (adjacent steps).
  const explicit = STAGE_REQUIREMENTS[key];
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
        const statuses = r.status === 'completed' ? ['COMPLETED'] : ACTIVE_MEETING_STATUSES;
        const m = await prisma.meeting.findFirst({
          where: {
            leadId: lead.id,
            type: r.meetingType as any,
            status: { in: statuses as any },
          },
          select: { id: true },
        });
        satisfied = !!m;
        break;
      }
      case 'meetingOrCall': {
        const [m, c] = await Promise.all([
          prisma.meeting.findFirst({
            where: { leadId: lead.id, type: r.meetingType as any, status: 'COMPLETED' as any },
            select: { id: true },
          }),
          prisma.call.findFirst({ where: { leadId: lead.id }, select: { id: true } }),
        ]);
        satisfied = !!m || !!c;
        break;
      }
      case 'quote': {
        const [q, f] = await Promise.all([
          prisma.quote.findFirst({ where: { leadId: lead.id }, select: { id: true } }),
          prisma.leadFile.findFirst({
            where: {
              leadId: lead.id,
              fileType: { in: ['QUOTATION', 'GENERATED_QUOTE'] as any },
              ...(r.stages?.length ? { stage: { in: r.stages as any } } : {}),
            },
            select: { id: true },
          }),
        ]);
        satisfied = !!q || !!f;
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
      case 'fileAnyOf': {
        const fileRecord = await prisma.leadFile.findFirst({
          where: {
            leadId: lead.id,
            fileType: { in: r.fileTypes as any },
            ...(r.stages?.length ? { stage: { in: r.stages as any } } : {}),
          },
          select: { id: true },
        });
        satisfied = !!fileRecord;
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
