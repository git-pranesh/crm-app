---
name: Quote Builder callback authentication
description: How POST /api/quotes/callback authenticates the external Quote Builder app, and the soft/hard-enforce pattern used for it
---

`POST /api/quotes/callback` is called directly by the external Quote Builder app (proposals.interiorsbydex.com, a separate Replit project outside this repo) whenever it creates a quote. It has no Supabase session, so `verifyToken` doesn't apply — it originally had no auth at all.

Fixed with a shared-secret header (`x-quote-builder-secret` vs `QUOTE_BUILDER_CALLBACK_SECRET`), but enforcement is **soft** by default: a missing/wrong secret is logged as a warning but the request still succeeds. Hard rejection only kicks in when `QUOTE_CALLBACK_HARD_ENFORCE=true` is set.

**Why:** flipping to hard auth immediately would break every real quote creation until the external Quote Builder app is *also* updated to send the header — that app's code isn't in this repo, so there's no way to verify/coordinate that from here in one step.

**How to apply:** don't set `QUOTE_CALLBACK_HARD_ENFORCE=true` until it's confirmed the Quote Builder app sends `x-quote-builder-secret` on every callback (check the warning logs for real mismatches first). The same soft/hard pattern is worth reusing for any other endpoint that must accept calls from a system outside this monorepo.
