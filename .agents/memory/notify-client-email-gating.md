---
name: Mandatory notifyClient checkbox pattern
description: Convention used across this CRM for gating client-facing emails behind an explicit checkbox, and a recurring bug shape found while wiring it up.
---

## Convention
Every client-facing email trigger point (meeting confirm/reschedule, on-hold, inactive,
reactivate, call-log summary, external task reminders, NPS surveys, stage-move survey)
takes an explicit `notifyClient` / `sendNpsSurvey` boolean from the request body and
gates only the `sendEmail`/mail-queue call with it — SMS/WhatsApp/internal
notifications and DB writes still fire regardless. Server treats a missing/explicit
`!== false` as default-true for backward compatibility with older callers; some routes
(meeting POST, on-hold status PATCH) instead 400 if the field isn't an explicit boolean,
to force new call sites to be deliberate. Frontend pairs each trigger with a checkbox
(default checked) shown only when the action would actually send mail (e.g. only when
`taskType === 'EXTERNAL'`, or only for NPS-triggering meeting types/stages).

**Why:** client explicitly asked for a "did you mean to email the client?" moment on
every outbound touchpoint, without suppressing internal recordkeeping.

## Recurring bug found twice
Two "respect the caller's notifyClient" functions (`markLeadInactive`, `reactivateLead`)
had hardcoded `const notifyClient = true` shadowing the actual `opts.notifyClient`
argument — the option was accepted but silently ignored. When auditing a gating flag
end-to-end, check the callee body itself, not just that the flag is threaded through
call sites — a local hardcoded reassignment is easy to miss in a quick grep.

## Automatic (non-user-initiated) triggers need a UI moment invented for them
NPS survey emails fire as a side effect of unrelated actions (completing a meeting,
moving a lead's stage) with no dedicated "send NPS" button. Gating these required
adding a checkbox to the *existing* completion/stage-move confirmation modal
(`StageCaptureModal`, meeting-status modal) rather than a new dedicated action —
look for the nearest existing confirmation step before inventing a new one.
