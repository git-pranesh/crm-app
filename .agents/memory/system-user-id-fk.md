---
name: SYSTEM_USER_ID FK gotcha
description: Default 'system' placeholder for SYSTEM_USER_ID is not a real user row; passing it straight to logActivity() throws/silently drops activity log entries.
---

`ActivityLog.userId` is a required FK to `User`. Several places default to
`process.env.SYSTEM_USER_ID ?? 'system'` for actions performed by automation
(webhooks, background jobs) — but no user with id `'system'` exists, and the
env var is typically unset. Calling `logActivity('system', ...)` throws a FK
violation, which async/`setImmediate` webhook handlers often swallow silently
(caught by an outer try/catch that just logs "Processing error"), so the
activity entry silently never appears — no error surfaced to the caller.

**Why:** found while verifying that ad-lead webhook creation logs an
auditable activity entry (task requiring CRE auto-assignment to be visible in
the lead timeline) — the entry was missing with no visible error.

**How to apply:** before trusting `logActivity(SYSTEM_USER_ID, ...)` in new or
touched code, check whether `SYSTEM_USER_ID` resolves to a real user. The
established fix (see `server/src/jobs/slaCheck.ts`) is a
`resolveSystemUserId()` helper: return the env var if explicitly set,
otherwise fall back to an active `BRANCH_HEAD` user id, caching the lookup.
`server/src/routes/leadWebhooks.ts` now does this too. `questionnaire.ts`
still has the raw unfixed pattern — worth applying the same fix if touched.
