---
name: MeetingType enum restriction pattern
description: How to "remove" a Postgres enum value from creatable options without physically dropping it.
---

When asked to remove a meeting/lead/etc. type from what users can select (e.g. retiring `DESIGN_FREEZE`/`SIGN_OFF` meeting types), do not drop the value from the Postgres enum if any historical rows or other code paths (NPS triggers, dashboards, reporting) still reference it.

**Why:** dropping an enum value that has live data or dependent code causes migration failures or silently breaks unrelated features (e.g. NPS survey triggers keyed off old meeting types).

**How to apply:** keep the enum value in the DB/Prisma schema, and enforce the restriction only at the application layer — define an allowlist constant (e.g. `CREATABLE_MEETING_TYPES`) and validate against it in the create endpoint. Read-only/reporting code paths that still reference the old values are left untouched.
