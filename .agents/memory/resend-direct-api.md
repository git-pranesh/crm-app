---
name: Direct Resend API delivery
description: The Dex CRM must send email through its own Resend API key rather than the Replit-managed connection.
---

Use `RESEND_API_KEY` with Resend’s direct `/emails` API for this CRM. The Replit-managed Resend connection can point to a different project/account, which causes domain-verification errors even when the Dex domain is verified in its own Resend account.

**Why:** The Dex Resend account and its verified `interiorsbydex.com` domain are separate from connections used by other Replit projects. A direct API send through the project secret was accepted and delivered in production.

**How to apply:** Keep the key server-only, send from `noreply@interiorsbydex.com`, retain the manual invite-link fallback for API failures, and log the Resend message ID when invite delivery is accepted.

**Testing gotcha:** Resend rejects `to` addresses on fake/non-deliverable domains (e.g. seeded `@example.com` test leads) with a 422 telling you to use "our testing email address" — this fails silently in this codebase because every `sendEmail(...)` call site here is wrapped in `.catch(() => {})`. When live-testing an email feature, temporarily point the lead's email at `delivered@resend.dev` (or another real inbox), confirm the `[email:resend] Sent ...` console line appears, then revert — don't trust "call succeeded" alone as proof the mail sent.