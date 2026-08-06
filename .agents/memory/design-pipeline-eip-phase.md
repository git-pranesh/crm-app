---
name: Design pipeline phases with null dateField
description: Phases in computeDesignPipelineTimeline whose dateField is null need an explicit fallback start date, or they get stuck at "upcoming" forever.
---

`computeDesignPipelineTimeline` (server/src/config/slaConfig.ts) derives each
phase's start date from `dates[idx]` (the phase's own `dateField`). A phase
declared with `dateField: null` (e.g. EIP) always resolves to `null`, so
without a fallback it stays `status: 'upcoming'` forever even after the prior
phase's milestone date is recorded — silently contradicting the UI's own
documented behavior.

**Why:** found as a live regression during SLA unit-test work — EIP never
progressed past "upcoming" no matter how long after Sign Off.

**How to apply:** any phase with `dateField: null` must fall back to the
previous phase's date (`dates[idx - 1]`) as its effective start, so elapsed
time is computed from when the previous milestone was recorded. Check for this
pattern before adding new phases to the pipeline.
