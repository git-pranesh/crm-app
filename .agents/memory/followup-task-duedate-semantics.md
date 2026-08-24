---
name: FollowUpTask.dueDate is a bare calendar-date marker, not an IST-midnight instant
description: How dueDate/dueTime/timeFrom combine into a real due-at instant — a common trap for jobs comparing against "now".
---

`FollowUpTask.dueDate` is created via `new Date(dueDateString)` from a plain
`YYYY-MM-DD` string, which JS parses as **UTC midnight of that calendar date**
(e.g. "2026-08-24" → `2026-08-24T00:00:00Z`). It is a bare calendar-day
marker, unlike the `istDayBounds()` UTC-instant boundaries used elsewhere in
the codebase for "midnight IST" — do not confuse the two.

The actual local time of day lives separately in `dueTime`/`timeFrom` (HH:MM
strings, IST wall-clock). To get the real due-at UTC instant for anything
that needs precision (e.g. a "due in the next hour" reminder), combine them
as: `dueDate.getTime() + hh*3600000 + mm*60000 - IST_OFFSET_MS` (subtracting
the fixed 5.5h IST offset once, since dueDate's UTC-midnight base already sits
5.5h ahead of true IST midnight).

**Why:** miscomputing this either direction silently shifts every due-soon
comparison by 5.5 hours, causing both missed and falsely-early reminders — a
real bug caught in this codebase's `upcomingDueReminder.ts` `taskDueAt()`
helper during first implementation.

**How to apply:** whenever building a new job/report that needs an exact
due-at timestamp for a `FollowUpTask`, use the formula above (or the shared
`taskDueAt()` in `upcomingDueReminder.ts`) rather than assuming `dueDate`
alone is enough or that it already encodes IST midnight.
