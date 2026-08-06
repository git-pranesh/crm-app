---
name: DIP checklist stage-gate is transitive
description: incentive/conversion queries filtering by DESIGN_IN_PROGRESS stage should also explicitly require dipChecklist.completedAt
---

The ONBOARDING_MEETING->DESIGN_IN_PROGRESS stage-gate (server/src/config/stageRequirements.ts, checkStageRequirements) already refuses the transition until the lead's DIPChecklist.completedAt is set, so reaching that stage implies checklist completion. Even so, code review flagged incentive-calculation queries for not making this explicit at the query itself (defense-in-depth against future gate bypass/imports/admin overrides).

**Why:** implicit gating via "you can't get here without passing the gate" isn't verifiable by reading the incentive query alone, and a reviewer/auditor can't confirm the invariant without cross-referencing a different file.

**How to apply:** any new/changed query that sums/counts leads at DESIGN_IN_PROGRESS for incentive or conversion purposes should add an explicit `dipChecklist: { completedAt: { not: null } }` filter (or an OR with the legacy HANDED_OVER stage, which predates the checklist model and has no DIPChecklist row).
