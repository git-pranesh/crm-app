---
name: Stage-gate funnel
description: How stage-transition gating works — skip-transition accumulation, requirement types, and gate-vs-checklist-action independence.
---

## Gating model
Gating is keyed by adjacent funnel-stage transitions. Forward jumps that skip stages accumulate all intermediate legs' requirements, but explicitly-allowed skip transitions can exclude specific items from that accumulation (e.g. a step's own meeting or file requirement isn't required when that step itself is being skipped). Backward/off-funnel moves are ungated. Multiple skip transitions can coexist — don't assume only one skip path exists; check the allow-list and the exclusion logic together before changing either.

## Requirement type vocabulary
Beyond simple "field must be non-empty" checks, gates may need: a meeting of a given type in a given status (scheduled vs. completed), "a completed meeting OR a logged call" when the source spec allows either, "a structured record OR a manually-uploaded file" when two different systems can produce the same proof, and "any one of several file types" when several document names satisfy the same checkpoint.

**Why:** a real bug ("uploaded the generated quotation but couldn't move stage") was caused by a gate checking only a structured DB record while the UI let users upload a file instead — these were different sources of truth for the same fact. Any future "prove X happened" gate should consider both a structured record and a manual-upload fallback unless explicitly told only one counts.

## Checklist action vs. generic baseline gate — must stay in sync
Some stage transitions have two enforcement paths: a generic direct-update gate, and a dedicated guided action (e.g. a "complete checklist and advance" button) that updates the stage itself and does NOT go through the generic gate. When a transition has both, the guided action must independently re-validate every baseline-gate requirement for that transition — it cannot rely on the generic gate having already run, because it bypasses it entirely by construction.

**Why:** a completion review caught exactly this drift once — the generic gate required a file upload for a transition, but the guided action that also performs that same transition never checked for it, so the guided path could bypass a mandatory requirement.

**How to apply:** whenever you add or change a requirement on a generic stage gate, grep for any dedicated action that also transitions between the same two stages, and update its own missing-requirements validation in lockstep. Don't treat the generic gate as the single source of truth if a bypassing action exists.

## Reusing existing fields for new "role-like" concepts
Before adding a new role/column for a concept that sounds like a new actor (e.g. "assign a manager"), check whether an existing field already serves that purpose at a later lifecycle stage. Reassigning/re-validating an existing assignment field via existing round-robin logic is usually correct; introducing a parallel field just because the terminology changed usually isn't.
