---
name: Design pipeline phase date projection
description: How to project future/unrecorded Design Pipeline phase dates from the 7 OB→OBM manual timeline dates, for anything (mail, UI, reports) that needs to show clients an estimated schedule.
---

When a feature needs to show projected dates for design phases that haven't
happened yet (e.g. an email or screen promising the client "estimated"
future dates), don't invent new date math — reuse
`config/slaConfig.ts`'s `DESIGN_PHASES` (8-phase list + which OBOBMChecklist
field holds each phase's actual date) and `DESIGN_PHASE_DEFAULT_DAYS` (each
phase's default day budget, summing to the 45-day overall SLA already used
for Design Pipeline SLA coloring).

**Why:** `computeDesignPipelineTimeline` (same file) already uses this data
to size elapsed/allocated days per phase for the Design Pipeline dashboard,
but it only reports *actual* recorded dates — it does not project dates for
phases with no date yet. A second, forward-looking projector was needed
(chain: unrecorded phase's date = previous phase's date, actual or
projected, plus the previous phase's default day budget; EIP has no budget
of its own and starts exactly when Sign Off does) and was added in
`routes/obObmChecklist.ts` as `projectDesignPhaseDates`, feeding a rendered
`{{timeline}}` HTML list into the OB_OBM_WELCOME mail template
(`lib/mailTemplates.ts`).

**How to apply:** If another feature (dashboard widget, PDF, different
mail) needs the same "here's your estimated schedule" data, extract
`projectDesignPhaseDates`/`renderTimelineHtml` into a shared helper instead
of duplicating the projection loop.
