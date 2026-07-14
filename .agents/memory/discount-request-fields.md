---
name: Discount request integrity
description: Discount % is server-derived; client pct is only cross-checked
---
POST /api/leads/:leadId/discount-request derives discountPct server-side from originalAmount/amount and rejects a client-supplied pct that mismatches (>0.1 tolerance). Amounts must be positive and amount < originalAmount.
**Why:** BL vs Branch Head approval authority keys off stored discountPct (>15% escalates); trusting client pct allowed threshold bypass.
**How to apply:** never store client-supplied discountPct directly; any new discount entry point must recompute it from amounts.
