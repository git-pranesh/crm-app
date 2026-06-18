# Interiors by DeX — CRM

A fully custom CRM built for Interiors by DeX, an interior design firm. Replicates and extends TeleCRM's capabilities with interior-design-specific workflows: lead pipeline, meetings with MOM, quote builder integration, discount approvals, WhatsApp/email automation, SLA alerting, and reports.

## Run & Operate

| Service | Command | Port |
|---|---|---|
| CRM Server (Express) | `cd server && PORT=3001 pnpm run dev` | 3001 |
| CRM Client (Vite + React) | `cd client && PORT=5173 pnpm run dev` | 5173 |

- `pnpm --filter @workspace/crm-server run dev` — run server only
- `pnpm --filter @workspace/crm-client run dev` — run client only
- `cd server && pnpm run db:generate` — generate Prisma client
- `cd server && pnpm run db:push` — push schema to Supabase (dev)
- `cd server && pnpm run db:migrate` — run Prisma migrations

## Stack

- **Backend:** Node.js 24, Express 4, TypeScript, `tsx` for dev
- **Database:** PostgreSQL via Supabase + Prisma ORM
- **Auth:** Supabase Auth with JWT
- **Job Queue:** BullMQ + Redis (reminders, SLA cron, scheduled emails)
- **File Storage:** Supabase Storage
- **Frontend:** React 18, Vite 5, TailwindCSS 3
- **Monorepo:** pnpm workspaces

## Where things live

```
/server/src/index.ts          — Express entry point
/server/src/routes/health.ts  — GET /api/health
/server/src/lib/prisma.ts     — Prisma client singleton
/server/src/lib/supabase.ts   — Supabase client (anon + admin)
/server/src/jobs/index.ts     — BullMQ queue definitions (reminders, sla, emails)
/prisma/schema.prisma         — Database schema (source of truth)
/client/src/App.tsx           — React root component
/client/tailwind.config.js    — Brand colors (terracotta/coral palette)
/client/vite.config.ts        — Vite config + /api proxy to server:3001
/.env.example                 — All required env var names with comments
```

## Architecture decisions

- Prisma schema lives at `/prisma/schema.prisma` (root); run `db:generate` from `/server` using `--schema=../prisma/schema.prisma`
- Vite proxies `/api/*` → `localhost:3001` so frontend never hard-codes the API URL
- `DIRECT_URL` (session pooler port 5432) is required alongside `DATABASE_URL` (transaction pooler port 6543) for Prisma migrations on Supabase
- BullMQ queues are defined centrally in `/server/src/jobs/index.ts` and imported by individual worker files as the queue grows
- Brand color palette (terracotta/coral, `brand-500 = #d95f32`) matches the existing Quote Builder at proposals.interiorsbydex.com

## Required Environment Variables

Copy `.env.example` → `.env` and fill in values before running.

Key vars:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` (transaction pooler, port 6543)
- `DIRECT_URL` (session pooler or direct, port 5432)
- `REDIS_URL`
- `JWT_SECRET`

## WhatsApp (Twilio) setup

WhatsApp delivery uses Twilio. **Without these three secrets, the CRM cannot send WhatsApp
messages** — the `/api/whatsapp/send` endpoint returns `503` and surfaces a clear error in the
UI (it never pretends a message was sent).

Required secrets:
- `TWILIO_ACCOUNT_SID` — from the Twilio Console dashboard
- `TWILIO_AUTH_TOKEN` — from the Twilio Console dashboard
- `TWILIO_WHATSAPP_NUMBER` — the WhatsApp-enabled sender in E.164, e.g. `+14155238886`
  (Twilio Sandbox) or the approved business sender. Stored without the `whatsapp:` prefix.

Optional:
- `DEFAULT_COUNTRY_CODE` — digits only, defaults to `91` (India). Lead numbers saved without a
  country code are normalised to E.164 against this before sending.
- `TWILIO_SMS_NUMBER` — separate sender used by SMS automations (shares the same Twilio account).

Setup steps:
1. **Sandbox (testing):** in Twilio Console → Messaging → Try it out → WhatsApp Sandbox, follow
   the join instructions from each test phone. Sandbox can only message numbers that have joined,
   and only with approved sandbox templates. Use the sandbox sender as `TWILIO_WHATSAPP_NUMBER`.
2. **Production:** register a WhatsApp Business sender and get message templates approved by Meta.
   Free-form (non-template) replies are only allowed inside the 24-hour customer service window;
   outside it, only approved templates send. A number that is not on WhatsApp, or a blocked
   template/session, causes Twilio to reject the send — the error is returned to the user as a
   `502` with Twilio's message (no silent fake).
3. **Inbound replies:** in the sender/sandbox config set "When a message comes in" to
   `POST {BASE_URL}/api/whatsapp/webhook` (e.g. `https://<your-domain>/api/whatsapp/webhook`).
   Inbound messages are matched to leads by the last 10 digits of the sender's number (checks both
   `phone` and `phone2`), so stored numbers with or without a country code still match.

## Product

8-stage lead pipeline (Effective Lead → MQL → DQL → Proposal Ready → Proposal Presented → Onboarding → Inactive → On Hold) with:
- 4 roles: Designer, CRE, Business Lead, Branch Head
- Call logging + mandatory follow-up tasks
- Meetings with auto-email/SMS triggers and mandatory MOM
- Embedded Quote Builder (proposals.interiorsbydex.com) with discount approval workflow
- WhatsApp + email automation (BullMQ)
- SLA engine with breach alerts
- Meta + Google Ads lead capture with UTM tracking
- Reports and per-designer/per-BL live dashboards

## User preferences

- No business logic until Task 1 schema is confirmed
- All 90 client features confirmed (see `attached_assets/` for full spec)
- Calling approach (Option A log-only vs Option B telephony) pending client decision
