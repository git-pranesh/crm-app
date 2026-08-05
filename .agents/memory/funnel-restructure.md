---
name: Sales funnel restructure
description: Active funnel shape, legacy-stage handling, skip-gating rule, and incentive-trigger-stage decision for the lead pipeline.
---

## Funnel shape
Active funnel: MQL → DQL → PROPOSAL_READY → PROPOSAL_PRESENTED → PROPOSAL_DISCUSSION → ONBOARDING → ONBOARDING_MEETING → DESIGN_IN_PROGRESS.
EFFECTIVE_LEAD and HANDED_OVER remain valid `LeadStage` enum values for legacy data only — they are excluded from the active funnel:
- EFFECTIVE_LEAD may only move forward into MQL (never straight into DQL/PP/etc.)
- HANDED_OVER can never be entered going forward now that DESIGN_IN_PROGRESS is terminal.

**Why:** the funnel was restructured to add Proposal Discussion / Onboarding Meeting / Design In Progress stages and move new-lead creation to start at MQL instead of Effective Lead, without breaking pre-restructure leads still sitting in the old stages.

## Skip-gating rule
DQL is the only stage allowed to skip forward (directly to PROPOSAL_PRESENTED). A skip must never skip its gate: the skip transition's requirement list has to be the union of every intermediate leg's requirements, not a hand-curated subset — otherwise a lead can reach a later stage with less verification than the step-by-step path would have required.

**How to apply:** when adding or reordering funnel stages, any configured skip transition in `stageRequirements.ts` should be built by spreading the accumulated legs' requirement arrays, not restated by hand.

## Incentive-trigger stage
DESIGN_IN_PROGRESS is the funnel's terminal/incentive-calculation stage (replacing the old ONBOARDING/HANDED_OVER trigger), with HANDED_OVER kept as an equivalent "won" state only for legacy leads that predate the restructure.

**Why:** Onboarding is no longer the last active-funnel stage, so the point at which incentives, conversion-rate reporting, and "won" leaderboards fire had to move down-funnel to stay meaningful. Any report/aggregation that treats a lead as "converted" should check `stage IN (DESIGN_IN_PROGRESS, HANDED_OVER)`, not `stage = ONBOARDING`.
