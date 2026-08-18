---
name: Discount-requests list endpoint scoping
description: GET /api/discount-requests must not return company-wide data to non-approver roles
---

`GET /api/discount-requests` (list/filter) originally had no role scoping beyond
`verifyToken` — any authenticated user (including DESIGNER/CRE) could see every
discount request org-wide (amounts, reasons, other people's leads), even though
the Discounts nav page is visible to all roles.

**Why:** only BL/BRANCH_HEAD have an approval mandate spanning other people's
requests; everyone else should only see what they personally raised
(`requestedById`). The per-lead call (`?leadId=`, used in DiscountTab) was
already safe; the unscoped org-wide call (`Discounts.tsx` page, no leadId) was not.

**How to apply:** when auditing any "list all X" endpoint that a broad set of
roles can reach via the UI, check whether the list is actually filtered
server-side for non-privileged roles — a route only enforcing `verifyToken`
with no `where` scoping is a common over-exposure pattern in this codebase.
