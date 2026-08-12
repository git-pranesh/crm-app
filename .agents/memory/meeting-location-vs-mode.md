---
name: Meeting location vs mode fields
description: Meeting has two separate location-flavored fields — don't conflate them when adding location-related features.
---

`Meeting.mode` and `Meeting.location` (plus its sibling free-text-turned-dropdown fields on related checklist records) are two independently tracked properties that happen to share an overlapping value vocabulary (both use "site visit"/"virtual"/"EC visit"-style values).

**Why:** the shared vocabulary makes it easy to assume one field is redundant with the other, or to validate/display the wrong one, when they are actually stored and edited independently on the same record.

**How to apply:** when touching meeting location/mode logic, grep for both `mode` and `location` usages before assuming which field a request is about, and check sibling checklist/reschedule fields for the same distinction.
