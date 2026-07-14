---
name: Task completion guard
description: Follow-up tasks require lead activity after creation; how the spawning call is excluded
---
Completing a follow-up task (PATCH /api/tasks/:id/complete) requires at least one ActivityLog row for the lead with createdAt strictly greater than task.createdAt (excluding TASK_CREATED/TASK_COMPLETED).
**Why:** client requirement — reps must not close follow-ups without doing anything.
**How to apply:** any new flow that creates a task as a side effect of an activity must write that activity's log row with createdAt equal to the task's createdAt (see calls route transaction), otherwise the spawning activity immediately satisfies the guard.
