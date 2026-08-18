---
name: Public base URL resolution
description: Shared helper for turning env vars into a real public URL for links sent outside the app (invites, emails)
---

`server/src/lib/baseUrl.ts` exports `resolveBaseUrl()`: explicit `BASE_URL` env
var first, else `REPLIT_DEV_DOMAIN` (auto-injected in the dev workspace),
else `null`.

**Why:** several routes previously hardcoded `process.env.BASE_URL ?? 'http://localhost:5173'`
(or similar) as a fallback for links emailed/shown to real people — e.g. the
admin "invite new user" flow. In production, `BASE_URL` wasn't set and
`REPLIT_DEV_DOMAIN` doesn't exist there either, so admins were silently handed
`http://localhost:5173/accept-invite/...` links nobody outside the container
could open. New hires got no working way to ever log in.

**How to apply:** any time you add or touch a route that builds an absolute
link for an email, invite, or webhook target, use `resolveBaseUrl()` instead
of a new hardcoded fallback. If it returns `null`, fail the request loudly
(don't send/persist a broken link) rather than falling back to localhost.
`BASE_URL` must be set explicitly for the **production** environment (set to
`https://fyx.interiorsbydex.com` as of this fix); dev needs no configuration
since `REPLIT_DEV_DOMAIN` covers it automatically.
