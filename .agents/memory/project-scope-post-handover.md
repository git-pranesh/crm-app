---
name: Project-level authorization once a lead reaches HANDED_OVER
description: Why lead-level assignedDesignerId/assignedBLId aren't reliable for scoping access to a Project record.
---

Once a lead's `Project` row exists, `lead.assignedDesignerId` / `lead.assignedBLId`
can already be empty on that lead even though the project clearly still has a
real owning designer/BL in practice — this isn't visible just by reading the
route code, it only shows up when you inspect real handed-over lead rows.

**Why this matters:** any access check for a project-scoped resource that
delegates purely to the parent lead's assignment fields will silently exclude
the people who actually work the project, once that lead has passed handover.

**How to apply:** when scoping access to a `Project` (or anything keyed off
it), treat the project's own owner field(s) as the primary source of truth,
falling back to the lead's assignment fields only as a secondary signal —
never the other way around.
