---
name: BL role permission scope
description: BL has different write permissions on leads vs. projects — don't apply one resource's rule to the other.
---

BL (Business Lead) has asymmetric permissions across the two main resources:

- **Leads** (`server/src/routes/leads.ts`): full read/write, same as other assigned roles. No `requireRole` blocklist exists there for BL — PATCH/POST on leads must stay open.
- **Projects** (`server/src/routes/projects.ts`): view-only. `GET /`, `GET /:id`, and `GET /pipeline` (pipeline itself is DESIGNER/CRE-only for all roles, unrelated to BL) remain open, but mutating routes — `PATCH /:id`, `POST /:id/attention-flag`, `PATCH /:id/attention-flag/:flagId/resolve` — return 403 for BL via an inline `blockBLWrite` middleware.

**Why:** product intent is that BL manages/sells the lead relationship but does not edit design-project execution data — Designer/CRE/Branch Head own that.

**How to apply:** when adding a new project-mutating route, add the same `blockBLWrite` guard. When touching leads routes, do not add a BL restriction — that would be a regression against explicit product intent.
