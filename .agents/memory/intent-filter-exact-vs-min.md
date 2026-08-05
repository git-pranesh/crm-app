---
name: Intent filter — exact vs minimum
description: leads.ts supports two different intent-rating query params; pick the right one per UI intent.
---

`GET /api/leads` (server/src/routes/leads.ts) supports two independent intent-rating filters:

- `intent` — exact match (`where.intentRating = parseInt(intent)`)
- `intentMin` — "at least N stars" threshold (`where.intentRating = { gte: min }`), and it is applied **after** `intent` in the handler so it silently overrides an exact match if both are ever sent together.

**Why:** these were added at different times for different UIs — a legacy "minimum intent" star selector vs. a later requirement for an exact-match filter. Nothing in the route deprecates either one.

**How to apply:** when wiring a new/changed filter UI, check which semantics the product spec actually wants ("only 4-star leads" vs "4 stars or better") and send the matching param — don't assume `intentMin` is the only or canonical one. Never send both from the same UI control.
