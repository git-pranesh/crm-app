---
name: Prisma Field Names
description: Non-obvious Prisma model/field naming gotchas for the Interiors by DeX CRM schema
---

## Key field naming facts

**DiscountRequest model** uses `amount` (not `requestedAmount`) for the proposed/discounted amount:
- `amount Decimal` — the designer's proposed amount
- `originalAmount Decimal` — the original/full amount
- `discountPct Decimal` — percentage discount
- `reviewedAt DateTime?` — must be set on approve/reject alongside `reviewedById`

**SLABreach** → Prisma client accessor is `prisma.sLABreach` (camelCase with S, L, A each upper)

**LeadStage enum** order (pipeline): `EFFECTIVE_LEAD → MQL → DQL → PROPOSAL_READY → PROPOSAL_PRESENTED → ONBOARDING`. Terminal: `INACTIVE`, `ON_HOLD`.

**supabase.ts exports**: `supabase` (anon client) and `supabaseAdmin` (service role client, null if key not set). No `getSupabase()` function exists.

**Call.recordingUrl** already exists in schema — no migration needed for Exotel stub.

**Why:** These field names caused bugs (requestedAmount vs amount, getSupabase vs supabaseAdmin) that crashed the server on startup. Record to avoid repeating.
