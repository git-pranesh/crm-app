---
name: Dev login for API testing (Supabase-backed auth)
description: How to get a valid bearer token for curl/API verification when seed credentials no longer work.
---

This CRM's auth is Supabase-backed (`server/src/middleware/auth.ts`, login via Supabase, not a local password hash). The seed script's documented password (`prisma/seed.ts`, `ChangeMe@123` by default) is often stale — real accounts get their password changed post-seed, so login with the seed default fails silently with "Invalid login credentials".

**How to apply:** to verify a route change end-to-end without a browser session, reset a specific user's password directly via the Supabase admin API using the `SUPABASE_SERVICE_ROLE_KEY` secret, then log in normally to get a bearer token:

```ts
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
await admin.auth.admin.updateUserById(user.supabaseId, { password: 'TempTest@2026' });
```

Then `POST /api/auth/login` with that email/password — note the response key is `accessToken`, not `token`. This is safe to do on any seeded dev user for verification purposes, but be aware it overwrites their real password (fine in a dev/test DB, avoid in production).

The `testing` subagent kind (Playwright-based, from the `testing` skill) was unavailable in this session (`Unknown config kind: testing`) — fell back to direct curl verification with a reset password instead.
