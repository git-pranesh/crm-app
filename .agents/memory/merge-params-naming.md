---
name: mergeParams route param naming
description: Express sub-router mounted under a named path param must destructure that exact param name, not a generic "id".
---

When a router is created with `Router({ mergeParams: true })` and mounted like `app.use('/api/leads/:leadId/questionnaire', questionnaireRouter)`, every handler inside it must read `req.params.leadId` — the parent's exact param name — not a generic `req.params.id`.

**Why:** `req.params.id` is simply `undefined` when the parent mounted the param as `:leadId` (or any other name). This doesn't throw — it silently passes `undefined` into whatever uses it (e.g. a Prisma `where: { leadId: undefined }`), which Prisma then rejects with a confusing "needs at least one of `id` or `leadId`" error at request time, not at startup. It's easy to miss because the route "looks" correct and only fails when actually called (e.g. `GET /api/leads/:leadId/questionnaire` was silently broken this way).

**How to apply:** When adding or auditing a handler on a `mergeParams` sub-router, check the exact param name in the parent's `app.use(...)` mount line and match it exactly in every `req.params.<name>` destructure inside that router.
