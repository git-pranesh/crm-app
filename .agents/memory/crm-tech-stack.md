---
name: CRM Tech Stack
description: Tech stack decisions, port assignments, and known gotchas for the Interiors by DeX CRM build
---

## Stack
- Backend: Express 4 + TypeScript, tsx for dev, port 3001
- Frontend: React 18 + Vite 5 + TailwindCSS 3, port 5173
- DB: PostgreSQL via Supabase + Prisma ORM
- Auth: Supabase Auth + JWT
- Queue: BullMQ + Redis
- Storage: Supabase Storage

## Prisma layout
- Schema lives at `/prisma/schema.prisma` (root level, not inside server/)
- Run Prisma CLI from `/server` using `--schema=../prisma/schema.prisma`
- Supabase requires two URLs: `DATABASE_URL` (transaction pooler, port 6543) and `DIRECT_URL` (session pooler, port 5432) for migrations

## Workflows
- "CRM Server" → `cd server && PORT=3001 pnpm run dev` (console type)
- "CRM Client" → `cd client && PORT=5173 pnpm run dev` (webview type)

## Known gotchas
- `postcss.config.ts` and `tailwind.config.ts` cause startup crash in Vite 5 ("ts-node required"). Must use `.js` extension for both. Fixed by using `postcss.config.js` and `tailwind.config.js`.
- Port 5001 is NOT in Replit's supported port list. Use 3001 for the API server.
- pnpm workspace: added `server` and `client` entries to `pnpm-workspace.yaml` packages list.

## Brand colors
- Terracotta/coral palette: brand-500 = #d95f32 (matches Quote Builder at proposals.interiorsbydex.com)
- Tailwind extended under `colors.brand`

**Why:** Matches existing client branding; must stay consistent across CRM and Quote Builder.
