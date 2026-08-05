---
name: SLA display layer (stage + design pipeline)
description: How the task #56 SLA badges/timeline are computed and where they live; how they relate to the older SLAConfig/slaCheck breach system.
---

Two SLA systems coexist by design, not accident:
- **Older breach system** (`SLAConfig` Prisma model, `server/src/jobs/slaCheck.ts` BullMQ job, `isSLABreached` flag, `/api/sla/breaches`): historical breach records + hourly job, drives notifications.
- **New display layer** (`server/src/config/slaConfig.ts`, `server/src/lib/stageSla.ts`, `GET /api/config/sla`): live, per-request `daysInCurrentStage`/`slaStatus` for the current stage, plus the 8-phase Design Pipeline timeline (45-day countdown from `OBOBMChecklist` phase dates). No notifications, no DB writes — purely computed on read.

**Why:** the two serve different purposes (audit trail + alerting vs. live UI badges); merging them risked destabilizing the existing breach/notification pipeline for a purely-cosmetic feature.

**How to apply:** if extending SLA behavior, check which of the two systems the change belongs to before touching either. `daysInCurrentStage` is derived by walking `ActivityLog` `STAGE_CHANGED` entries (same pattern as `/api/leads/:id/stage-history`) — no new DB fields. Design phase "allocated days" fall back to a static per-phase default (`DESIGN_PHASE_DEFAULT_DAYS`, sums to 45) when the next phase's actual start date isn't known yet. Breach threshold is strict `elapsed > allocated`; warning is `elapsed >= 70% of allocated`.

Dashboard's designer performance category labels (`Design Performance`, `Timeline Adherence`, renamed from `Design Quality`/`Delivery`) live in `server/src/routes/dashboard.ts`, nested under the response's `designerDash.performanceScore.categories` — only populated for DESIGNER/CRE role requests, not BRANCH_HEAD/ADMIN.
