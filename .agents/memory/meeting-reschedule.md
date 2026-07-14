---
name: Meeting reschedule semantics
description: Rescheduling keeps the meeting active with a new time
---
PATCH /api/meetings/:id/status with status=RESCHEDULED requires newScheduledAt (ISO); server moves scheduledAt to it and sets status back to SCHEDULED so the meeting stays actionable. rescheduledReason stored; activity meta includes newDate.
**Why:** a terminal RESCHEDULED status hid the action buttons and orphaned the meeting.
**How to apply:** don't treat RESCHEDULED as a final meeting state anywhere (filters, dashboards); a rescheduled meeting appears as SCHEDULED with a rescheduledReason.
