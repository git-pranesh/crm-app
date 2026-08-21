---
name: IST datetime-local conversion pattern
description: How this CRM converts stored UTC timestamps to/from HTML date and datetime-local input values, always in IST wall-clock time.
---

The app is India-only scope (existing `IST_TZ = 'Asia/Kolkata'` convention). Any `<input type="date">` or `<input type="datetime-local">` that shows or edits a stored timestamp must go through the shared helpers in `client/src/lib/dateFormat.ts`:

- `istDateOnly(iso)` — stored UTC ISO string → `YYYY-MM-DD` in IST, for `<input type="date">` value/min/max.
- `istDatetimeLocalValue(iso | Date)` — stored UTC ISO / Date → `YYYY-MM-DDTHH:mm` in IST, for `<input type="datetime-local">` value/min/max.
- `istInputToISO(value)` — a `date`/`datetime-local` input's raw string value (assumed to represent IST wall-clock time) → UTC ISO string to send to the server.
- `todayISTDateString()` — today's date in IST as `YYYY-MM-DD`, for `min` attributes anchored to "today".

**Why:** `new Date(value).toISOString()` and `.toISOString().slice(0, 10/16)` interpret the input/output in the *browser's* local timezone, not IST. On a server or client not in IST (or during any host/timezone drift), this silently shifts dates/times — meetings landing on the wrong calendar day, "today" cutoffs firing at the wrong wall-clock hour, etc. This caused a real bug in `client/src/pages/Calendar.tsx` where events grouped onto the wrong day/hour.

**How to apply:** Whenever you touch a call site that does `new Date(...).toISOString()`, `.toISOString().slice(...)`, or `.toLocaleString/toLocaleDateString('en-IN', ...)` without `timeZone: 'Asia/Kolkata'`, replace it with the matching helper above instead of a one-off fix. Known remaining call sites as of 2026-08-21 (not yet swept): none outstanding after this pass — `LeadDetail.tsx`, `MeetingsTab.tsx`, `CallLogTab.tsx`, `NextPlanOfActionPicker.tsx`, `Calendar.tsx` are done; re-check `Pipeline.tsx`'s `fmtDate` if it resurfaces in a future complaint.
