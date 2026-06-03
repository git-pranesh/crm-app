---
name: Prisma migrate command
description: How to run Prisma migrations in this monorepo — schema is at root, not inside server/.
---

The Prisma schema lives at `prisma/schema.prisma` (workspace root), not inside `server/`.

Running `cd server && npx prisma migrate dev` fails with "Could not find Prisma Schema".

**Correct command (from workspace root):**
```
npx prisma migrate dev --name <migration_name> --schema=prisma/schema.prisma
```

**Why:** The project is a pnpm monorepo with the schema at root for shared access between `server/` and any future packages. The `server/package.json` does not have a `prisma` config pointing to the schema.

**How to apply:** Always run Prisma commands from `/home/runner/workspace` (the workspace root), not from inside `server/`.
