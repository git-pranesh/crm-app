---
name: Designation vs Role
description: Pattern for adding a new "title" (e.g. Design Team Lead) without touching authorization.
---

When a request asks to add a new role/title name but explicitly says "no new permissions" or
"identical permissions to their prior role," do NOT add it as a new value in the `Role` enum —
that enum drives every `requireRole()` / permission check in the app, so adding a member forces
a full audit of every permission site to grant it parity, which is a much bigger blast radius
than the request asked for.

**Pattern used:** added a separate `Designation` enum + nullable `User.designation` column that
is purely a display-only title layered on top of the existing `role`. Admin invite/edit UI shows
it as a secondary "Designation" dropdown (only when role is the relevant base role), and it's
rendered as the display label instead of the raw role badge when present. Nothing that reads
`user.role` for authorization was touched.

**Why:** keeps "add a title" changes additive and low-risk; new designations can be appended to
the enum later without any permission-logic changes, matching how the founder said further
designations/functionality would come "in a later phase."

**How to apply:** if a future request adds another title (not a new access level) on top of an
existing role, extend the `Designation` enum and the `DESIGNATION_LABELS` map in `Admin.tsx`
rather than touching `Role` or any `requireRole(...)` call site.
