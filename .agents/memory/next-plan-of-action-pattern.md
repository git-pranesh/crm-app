---
name: Next plan of action shared pattern
description: How the Call/Meeting/Task "next plan of action" multi-select is modeled and wired end-to-end.
---

A "next plan of action" feature lets a user attach 0-N follow-up items (Call/Meeting/Task) to a call log or meeting-completion action, each independently flagged for a client-facing email. Model it as one shared discriminated-union JSON field (not three separate per-kind fields) reused everywhere the flow appears, plus one shared processor function and one shared picker UI component.

**Why:** the record kinds it can spawn have very different required fields, but the "attach N items, each independently flagged" UX and validation shape is identical wherever it's offered — duplicating it per call site invites the fields/validation to drift out of sync (as happened here: meeting mode and MOM-attachment-type allowlists were defined in three places with three different value sets before being consolidated).

**How to apply:** centralize the enum/date validation for every item kind in one function, call it before any DB write for the primary record (fail the whole request on the first invalid item rather than silently skipping bad items while reporting success), and never let the picker accept an arbitrary assignee/target id — always resolve to the acting user rather than trusting a client-supplied id, to avoid authorization bypass.
