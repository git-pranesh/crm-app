---
name: Stage roadmap has one gate-info icon per stage node
description: Each stage circle in the Stage Roadmap has its own separate ⓘ popover for "gate to next stage" — easy to click the wrong node's icon during testing/review.
---

`LeadDetail.tsx`'s Stage Roadmap renders a small ⓘ info button per stage node,
each showing that specific node's own "Gate to <next stage>" popover (adjacent
transition only, fetched live from `/leads/:id/can-advance?fromStage=X&toStage=Y`).
It is easy to click a neighboring node's icon by mistake (e.g. clicking the
node after the current one) and misread its popover as belonging to the
current stage's gate — the title line ("Gate to X") is the only way to tell
which transition you're actually looking at.

**Why:** caused a false-positive "bug" report during a UI test pass — the
tester opened the *next* node's gate (2 items, both unmet) instead of the
*current* node's gate (9 items, 2 satisfied/green + 7 unmet/red), and
concluded the red/green split wasn't working, when it actually was.

**How to apply:** when testing or reviewing this popover, always read the
"Gate to <stage>" title text to confirm which transition is showing before
judging whether the satisfied/unmet colors look right.
