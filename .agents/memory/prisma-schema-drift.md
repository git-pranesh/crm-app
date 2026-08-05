---
name: Prisma schema vs live DB drift
description: schema.prisma has pre-existing mismatches with the actual database that make plain `prisma db push` destructive.
---

## What's wrong
Past migrations renamed fields in `schema.prisma` (e.g. `isSpecialCase` → `is_special_case` style) without an `@map(...)` back to the original column and without dropping the old one, so some tables carry both a camelCase and a snake_case copy of the same field. Prisma Client only reads/writes the camelCase ones; the snake_case ones are dead. Separately, at least one table has real duplicate rows that violate a constraint the schema wants to add.

**Why this matters:** running `prisma db push` (with or without `--accept-data-loss`) against this drift will either propose dropping columns that may still need verification, or fail outright on the constraint due to existing duplicate rows.

## How to apply schema changes safely until this is cleaned up
Don't run a plain `prisma db push` for unrelated schema changes (e.g. adding an enum value or column) — it will surface this same drift every time. Instead:
1. Diff what you actually need against the current DB (`information_schema.columns`, `enum_range()`, etc. via SQL).
2. Apply just those changes with raw SQL (e.g. `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `ALTER COLUMN ... SET DEFAULT`).
3. Write a matching migration file under `prisma/migrations/` (idempotent SQL) and run `prisma migrate resolve --applied <folder>` so Prisma's tracking table matches reality — do not use `migrate dev`.
4. Run `prisma generate` afterward so the client types match.

This leaves the pre-existing drift (dead legacy columns, duplicate rows blocking a constraint) untouched — it needs its own dedicated cleanup task that first resolves the duplicate rows and confirms the legacy columns are truly unused before dropping them.
