---
name: Client checklist / bug-list validation pattern
description: How to treat a long client-supplied "still broken" checklist — verify every row against current code before building; a meaningful fraction is often already fixed or based on a stale/incorrect description.
---

When handed a large external bug/requirement checklist (e.g. a "master checklist" doc), audit every row against the live codebase (file:line evidence) before creating any build tasks. In one such audit (Aug 2026), roughly a third of 43 claimed-broken items were already correctly implemented or based on a misdescription of current behavior (e.g. a stage-skip rule that already matched the request, a rep-login scoping that was already correct, a checklist model that already existed in full contrary to "doesn't exist yet").

**Why:** building blind off a client's bug list re-implements things that already work, wastes cycles, and erodes trust when the "fix" changes nothing observable.

**How to apply:** classify every row into (a) confirmed bug matching the complaint, (b) already correct / claim is outdated, (c) ambiguous or requires a product decision — and only build (a). Push (c) back as explicit questions rather than guessing, especially when the client has stated a "ask us, don't guess" rule of their own.
