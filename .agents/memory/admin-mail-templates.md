---
name: Admin-editable mail template registry
description: Pattern for letting admins customize default subject/body of system-triggered emails, distinct from WhatsApp templates which are read-only.
---

`server/src/lib/mailTemplates.ts` holds a registry of admin-editable email
defaults (code, label, `{{placeholder}}` tokens, default subject/html).
Overrides are stored as one JSON blob on `AssignmentConfig` (key
`mail_template_overrides`), reusing the same generic key-value config table as
SLA threshold overrides — no new table needed. `renderMailTemplate(code, vars)`
merges override-or-default then fills placeholders; call sites (pdObChecklist,
obObmChecklist, meetings.ts) became `async` to await it. Admin CRUD lives at
`/api/admin/mail-templates` (GET list, PUT :code to set, DELETE :code to reset).

**Why:** the founder's spec asked for "all system mail/WhatsApp templates" to
be admin-editable, but WhatsApp templates are pre-approved with Meta/Twilio
for the WhatsApp Business API — editing them in-app isn't possible without
re-approval, so `/api/admin/whatsapp-templates` stays intentionally read-only.
Only mail templates are covered by this registry.

**How to apply:** when adding a new system email, register it here instead of
hardcoding subject/html in the route file, so it's automatically admin-editable
without further plumbing.
