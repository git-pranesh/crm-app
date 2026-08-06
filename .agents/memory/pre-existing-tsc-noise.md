---
name: Pre-existing tsc --noEmit noise in this CRM
description: Known categories of tsc errors that exist independent of any current change — check git-stash diff before assuming a new change caused them.
---

Running `npx tsc --noEmit` in `server/` has ~27 pre-existing errors unrelated to
feature work, in two families:

1. **ioredis / @types/express dual-version conflicts.** `@types/multer` pulls
   in `@types/express@5.x` → `@types/express-serve-static-core@5.x`, which
   conflicts with the rest of the app pinned to `@types/express@4.x`. Shows up
   as `RateLimitRequestHandler`/`IRouterMatcher` "no overload matches" errors
   in `src/index.ts`, and as `ioredis@5.11.0` vs `ioredis@5.10.1` connector
   type mismatches in job/queue files. Not caused by adding devDependencies
   (verified: `pnpm add -D vitest` only added packages, no version bumps to
   existing deps, and the same error count/lines existed before and after).
2. Scattered one-off Prisma JSON-field and route type errors (`activityLog.ts`,
   `admin.ts`, `import.ts`, `quotes.ts`, `reports.ts`, `sla.ts`).

**Why:** wastes time repeatedly re-diagnosing "did I break this?" after every
change. **How to apply:** before treating a tsc error as a regression, grep
the error text against this list; if it matches, confirm via `git stash` on
just the suspected file(s) and re-run tsc rather than assuming causation.
