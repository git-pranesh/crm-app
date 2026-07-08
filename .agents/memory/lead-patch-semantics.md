---
name: Lead PATCH clear semantics
description: How PATCH /api/leads/:id distinguishes "not sent" vs "clear" for optional project fields
---

Optional project fields on PATCH /api/leads/:id (projectType, scope, location, possessionTimeline, estimatedValue, nextMeetingDate, floorPlanUrl, phone2, email) use `!== undefined` checks: omitting a key leaves the value untouched; sending `null` or `""` clears it to null.

**Why:** The original truthy-spread (`...(field && {...})`) made clearing impossible — blank edits silently retained stale data (caught in architect review of the EL→MQL blocker fix).

**How to apply:** Client edit forms should send `null` (not omit) for cleared fields. `datetime-local` inputs must be prefilled in *local* time (pad-format from Date getters, not `toISOString().slice(0,16)`) and submitted as `new Date(value).toISOString()`.
