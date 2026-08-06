---
name: Round-robin assignment layer
description: Where CRE/BL/designer round-robin lead assignment lives and a gap in when it fires.
---

`server/src/services/assignmentService.ts` is the single source of truth for
round-robin/smart lead assignment:
- `selectBLForLead()` — BL with fewest `totalLeadsAssigned`.
- `assignLeadToDesigner()` — designer within a BL's team, tier-aware if
  `SMART_ASSIGNMENT_ENABLED=true`.
- `selectCREForLead()` — CRE with fewest `totalLeadsAssigned` (added for ad
  lead qualification routing).

**Why it matters:** the BL auto-assign trigger ("G5" in `leads.ts` PATCH
`/:id`) only fires inside `if (stage && stage !== prevStage)` — i.e. on an
actual stage *transition*. A lead that is *born* already sitting at a given
stage (e.g. webhook-created ad leads created directly at `MQL`) never fires
that transition, so it would sit unassigned to a BL forever unless something
else triggers it.

**How to apply:** when adding any "auto-assign on stage X" business rule,
check whether leads can enter that stage via direct creation (webhooks,
manual creates) as well as via a PATCH transition, and cover both paths —
either trigger on creation too, or (as done for task #77) also trigger when
the lead is moved *past* that stage while still unassigned.
