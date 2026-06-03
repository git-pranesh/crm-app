import twilio from 'twilio';

// ── WhatsApp templates (stored in code, referenced by templateId) ─────────────
export const WA_TEMPLATES: Record<string, string> = {
  pre_call_intro:
    'Hi {{clientName}}, this is {{designerName}} from Interiors by DeX. I would love to connect and understand your interior design requirements. When would be a good time to speak?',
  rnr_followup:
    'Hi {{clientName}}, I tried reaching you but could not connect. I am here to help with your interior design journey. Please let me know a convenient time to talk!',
  meeting_confirmation:
    'Hi {{clientName}}, your {{meetingType}} meeting is confirmed for {{scheduledAt}}. Mode: {{mode}}. Looking forward to meeting you! — Team Interiors by DeX',
  mom_sent:
    'Hi {{clientName}}, thank you for the meeting today! I have sent the meeting summary to your email. Please review and reach out if you have any questions.',
  onboarding_welcome:
    'Welcome aboard, {{clientName}}! 🎉 We are thrilled to start your interior design journey with Interiors by DeX. Your designer {{designerName}} will be your primary point of contact.',
  on_hold_notification:
    'Hi {{clientName}}, we noticed your project with Interiors by DeX is currently on hold. If you are ready to resume or would like to discuss, please reach out. We are here to help!',
};

// ── Fill template placeholders ────────────────────────────────────────────────
export function fillTemplate(templateId: string, vars: Record<string, string>): string {
  const tpl = WA_TEMPLATES[templateId];
  if (!tpl) throw new Error(`Unknown WhatsApp template: ${templateId}`);
  return tpl.replace(/{{(\w+)}}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── Twilio client (lazy) ──────────────────────────────────────────────────────
let _client: ReturnType<typeof twilio> | null = null;

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set in .env');
  }
  if (!_client) _client = twilio(sid, token);
  return _client;
}

export function isTwilioConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_NUMBER
  );
}

// ── Send a WhatsApp message via Twilio ────────────────────────────────────────
export async function sendWhatsAppMessage(to: string, body: string): Promise<string | null> {
  if (!isTwilioConfigured()) {
    console.log(`[whatsapp:dev] Would send to ${to}: ${body}`);
    return null; // No real SID in dev
  }

  const from = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;
  const toWa = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

  const message = await getTwilioClient().messages.create({ from, to: toWa, body });
  return message.sid;
}
