---
name: Stage-gate funnel
description: How lead stage-transition gating is structured so future edits stay consistent
---

Stage requirements live in `server/src/config/stageRequirements.ts` as a single
config keyed by **adjacent** funnel transitions (`FROM->TO`). The funnel order is
`EFFECTIVE_LEAD -> MQL -> DQL -> PROPOSAL_READY -> PROPOSAL_PRESENTED -> ONBOARDING
-> HANDED_OVER`. `INACTIVE`/`ON_HOLD` are off-funnel.

**Rule:** a forward stage move (including jumps that skip stages) must satisfy the
requirements of **every intermediate adjacent step**, not just the direct pair — the
checker expands the path via `FUNNEL_ORDER`. Backward moves and off-funnel stages are
ungated.

**Why:** keying only by exact `FROM->TO` pairs let a caller bypass gates by jumping
ahead (e.g. EFFECTIVE_LEAD->ONBOARDING). Accumulating intermediate requirements closes
that hole while keeping the config as simple adjacent-step entries.

**How to apply:** to add/adjust a gate, edit only the adjacent-step entry in
`STAGE_REQUIREMENTS`; jump enforcement is automatic. The route gate validates the
prospective merged state (current lead + PATCH body) and returns `400 {error, missing}`.
