---
name: Mail delivery path (Nodemailer vs Resend)
description: Why "we tested and no email arrived" can be true even though the code path runs cleanly — check the actual mailer being used before assuming delivery works.
---

Client mail triggers (welcome mail, OBM mail, MOM mail, etc.) run through `server/src/lib/email.ts` (Nodemailer/SMTP), not the installed Resend integration (`server/src/lib/resendEmail.ts` exists but is unused by any trigger route). Without SMTP env vars configured, `email.ts` silently falls back to a `jsonTransport` that only logs "Would send" to console — callers see success, no error is thrown, and nothing is actually delivered.

**Why:** discovered while auditing a client complaint that mail "is not sending at all" (tested with two real addresses, nothing arrived) — traced through `pdObChecklist.ts`, `obObmChecklist.ts`, and `meetings.ts`, all of which call `sendEmail()` assuming it delivers.

**How to apply:** before trusting any "email sent to client" feature actually works, check whether SMTP env vars are set, or migrate the send path to the already-installed Resend connector for a guaranteed working path. Don't assume `sendEmail()` resolving without error means the client received anything. Task #157 tracks fixing this.
