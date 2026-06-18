---
name: WhatsApp/Twilio delivery
description: How WhatsApp send/receive behaves and the credential + phone-format constraints that make it actually deliver
---

# WhatsApp delivery (Twilio)

Delivery uses the `twilio` SDK reading credentials directly from `process.env`
(`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`). SMS shares the same
Twilio account via `server/src/services/smsService.ts`.

**Rule: never fake-send.** `sendWhatsAppMessage` returns `null` only when Twilio is
unconfigured (dev) and throws on real failures. Callers must only persist an OUTBOUND
`whatsAppMessage` when a real Twilio SID came back — otherwise the UI shows a phantom
"sent" bubble while nothing was delivered. The manual `/send` route returns 503 (unconfigured)
or 502 (Twilio error) instead of storing a phantom message.
**Why:** the original bug was exactly this — no creds, dev-mode logged, returned `sent:true`,
stored phantom messages, so the client thought messages sent but nothing arrived.

**Phone format:** lead numbers are often stored without a country code (Indian firm, 10-digit
mobiles). Twilio needs E.164, so `normalizePhoneE164()` prepends `DEFAULT_COUNTRY_CODE`
(default `91`) before sending. Inbound webhook matches a lead by the **last 10 digits**
(`endsWith`, checking both `phone` and `phone2`) because Twilio's `From` is `whatsapp:+91...`
but stored numbers may lack the prefix.

**Known follow-up gaps (not yet done):** Twilio webhook signature validation is absent
(`/api/whatsapp/webhook` is unauthenticated); there is no async delivery-status callback / no
status column on `WhatsAppMessage`. A Replit Twilio *connector* integration exists but the code
uses raw env vars, not the connector proxy.
