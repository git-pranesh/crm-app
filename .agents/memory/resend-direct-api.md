---
name: Direct Resend API delivery
description: The Dex CRM must send email through its own Resend API key rather than the Replit-managed connection.
---

Use `RESEND_API_KEY` with Resend’s direct `/emails` API for this CRM. The Replit-managed Resend connection can point to a different project/account, which causes domain-verification errors even when the Dex domain is verified in its own Resend account.

**Why:** The Dex Resend account and its verified `interiorsbydex.com` domain are separate from connections used by other Replit projects. A direct API send through the project secret was accepted and delivered in production.

**How to apply:** Keep the key server-only, send from `noreply@interiorsbydex.com`, retain the manual invite-link fallback for API failures, and log the Resend message ID when invite delivery is accepted.