---
name: Checklist gate completeness
description: Server-side stage-transition endpoints must validate every field a checklist UI marks as "required", not just the ones convenient to check.
---

When a stage-transition checklist (e.g. PD→OB, OB→OBM) lists an item as
required in the UI (missing-requirements hint, required badge, etc.), the
send/complete endpoint must independently re-validate that exact same item
server-side before allowing the mail send / stage advance. It's easy to wire
up persistence (PATCH saves the field) and a nice-looking "missing" list in
the UI, while forgetting to also gate the actual completion action on the
same fields — this was caught twice in one review cycle for the same feature
(free-text notes field, and a batch of 7 date fields that schema comments had
mislabeled as "informational/non-gating").

**Why:** completion-review explicitly diffs the checklist's stated
requirements against what the send endpoint actually enforces; any gap is
treated as a correctness bug even if it "looks" done in the UI.

**How to apply:** when adding or reviewing a checklist-gated transition,
enumerate every item the UI calls required, then grep the send/complete
endpoint to confirm each one has a corresponding validation check (not just a
PATCH field). Fix comments/schema docs that describe a field as non-gating if
the product spec actually requires it.
