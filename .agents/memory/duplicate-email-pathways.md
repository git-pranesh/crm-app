---
name: Duplicate email delivery pathways in this CRM
description: Two independent send paths existed before the Resend integration was wired in; both must route through the same helper or one silently bypasses the real provider.
---

`lib/email.ts`'s `sendEmail()` and `lib/emailService.ts` (`sendEmailByType`/`sendDraft`, used by the draft/preview endpoints in `routes/email.ts`) used to each keep their own separate Nodemailer transporter. Fixing delivery in one did nothing for the other — a caller going through `routes/email.ts`'s send-draft endpoint still silently "succeeded" via console-only jsonTransport even after `lib/email.ts` was fixed.

**Why:** When adding/fixing an email provider (Resend, SMTP, etc.), grep for *all* `createTransport`/`nodemailer` usages, not just the one call site you were pointed at — there can be more than one independent transporter in this codebase.

**How to apply:** `emailService.ts` now delegates to `sendEmail()` from `lib/email.ts` instead of keeping its own transporter, so there is exactly one send path (Resend → SMTP → dev-guard) for all client-facing mail, including drafts.

Also note: the draft store in `emailService.ts` (`saveDraft`/`getDraft`/`sendDraft`) is in-memory only — a server/workflow restart between "save draft" and "send draft" silently loses the pending draft (the send then 404s with "Draft not found"). This is acceptable for now (drafts are meant to be actioned within the same session) but would need Redis/DB-backed storage before treating it as durable.
