---
name: DB environment (helium vs stale .env)
description: Which Postgres the CRM actually uses at runtime vs what CLI tools see, and how to apply schema changes
---

The active database is the **Replit-managed Postgres**: host `helium`, db `heliumdb`,
user `postgres`, exposed via the injected **process-env** `DATABASE_URL`
(`postgresql://postgres:***@helium/heliumdb?sslmode=disable`) and the `PG*` env vars.
It holds all 26 CRM tables and the seeded data.

The root `.env` `DATABASE_URL`/`DIRECT_URL` point at a stale, unreachable
`localhost:5432/dex_crm` (leftover from an earlier local-PG setup).

**Why it still works at runtime:** dotenv does NOT override an already-set
`process.env`, so the server keeps the injected `helium` URL and ignores the stale
`.env` value. CLI tools that read `.env` directly (e.g. `prisma migrate` using
`DIRECT_URL`) instead hit `localhost` and fail with P1001.

**How to apply schema changes:** keep `directUrl` COMMENTED in
`prisma/schema.prisma` (so Prisma uses only `DATABASE_URL` = helium from process env),
then run `pnpm --filter @workspace/crm-server run db:push` (= `prisma db push`).
This is the project's reconciliation mechanism (`scripts/post-merge.sh` runs
`pnpm --filter db push`). Do NOT use `prisma migrate dev` — its shadow DB / DIRECT_URL
resolves to the dead localhost. Verify with
`psql "postgresql://postgres:password@helium:5432/heliumdb" -c "\d <table>"`.

**Note:** earlier memory called the stack "Supabase" — the current environment is the
Replit-managed local-network Postgres, not Supabase.
