---
name: Gap patch summary
description: Key decisions from the 13-gap patch applied to the CRM — HANDED_OVER stage, DIP checklist gate, new env vars, activation-required features.
---

## HANDED_OVER stage (9th stage)
- Added after ONBOARDING in LeadStage enum.
- To enter HANDED_OVER: DIPChecklist.completedAt must be set. The PATCH /api/leads/:id endpoint returns HTTP 409 if this gate is not met.
- DIPChecklist is auto-created when a lead enters ONBOARDING stage (via leads.ts PATCH side-effect).
- HANDED_OVER leads are excluded from SLA checks (slaCheck.ts FIRST_CONTACT rule uses `notIn: ['INACTIVE', 'ON_HOLD', 'HANDED_OVER']`).
- HANDED_OVER excluded from leadAging report in reports.ts.
- PIPELINE_STAGES in reports.ts includes HANDED_OVER.
- Teal color: `bg-teal-100 text-teal-700` (frontend), `#0d9488` (Dashboard chart).

## DIP Checklist
- Model: DIPChecklist (4 boolean fields + internalMailThreadUrl + completedAt).
- PATCH /api/leads/:id/dip-checklist — BL role only (requireRole('BL')).
- Auto-notifies all BRANCH_HEAD users when completedAt is set.
- DIPChecklistPanel component renders only when lead.stage is ONBOARDING or HANDED_OVER.

## New env vars needed (not yet set)
- `TWILIO_SMS_NUMBER` — Twilio SMS sender number (separate from WhatsApp number).
- `SMART_ASSIGNMENT_ENABLED=true` — activates tier-based designer assignment (default: false, falls back to round-robin).
- `BASE_URL` — public URL for feedback form links in SMS messages.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL` — for invite emails (falls back to console.log if not set).
- `SYSTEM_USER_ID` — used as actor for Google Form webhook activity logs.

## Activation-required features
- Google Form webhook: client must set up Apps Script trigger; see `docs/google-form-setup.md`.
- Exotel webhook: set `EXOTEL_SID` and `EXOTEL_KEY` when credentials provided.
- Smart assignment: set `SMART_ASSIGNMENT_ENABLED=true` when ready.

## Prisma model naming quirks for new models
- `prisma.dIPChecklist` (not `prisma.dipChecklist`)
- `prisma.dQLQuestionnaire` (not `prisma.dqlQuestionnaire`)
- `prisma.smsLog` (normal camelCase)
- `prisma.assignmentConfig` (normal camelCase)

## Additive-only rule
All changes were additive: new fields are nullable or have defaults, existing functions were extended not rewritten, no existing endpoints were deleted.

**Why:** The client's prod DB had existing data; destructive migrations would break it. Additive-only keeps rollbacks safe.
