import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import { sendEmail } from './email.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates/email');

// Real delivery (Resend / SMTP / dev-guard) is centralized in ./email.ts —
// this module used to keep its own separate Nodemailer transporter, which
// silently bypassed Resend entirely. It now delegates to sendEmail().

// ── Fill HTML template with variables ────────────────────────────────────────
function fillTemplate(templateName: string, vars: Record<string, string>): string {
  const filePath = resolve(TEMPLATES_DIR, `${templateName}.html`);
  let html = readFileSync(filePath, 'utf-8');
  for (const [key, val] of Object.entries(vars)) {
    html = html.replaceAll(`{{${key}}}`, val);
  }
  return html;
}

// ── Email type → template mapping ─────────────────────────────────────────────
const EMAIL_TEMPLATES: Record<string, { template: string; subject: string }> = {
  MEETING_CONFIRMATION: { template: 'meeting_confirmation', subject: 'Meeting Confirmed — Interiors by DeX' },
  MOM: { template: 'mom', subject: 'Meeting Summary — Interiors by DeX' },
  ONBOARDING: { template: 'onboarding', subject: 'Welcome to Interiors by DeX!' },
  NO_SHOW: { template: 'no_show', subject: "We Missed You — Let's Reconnect" },
  RESCHEDULED: { template: 'rescheduled', subject: 'Meeting Rescheduled — Interiors by DeX' },
  ON_HOLD: { template: 'on_hold', subject: 'Project Update — Interiors by DeX' },
  INACTIVATION_FEEDBACK: { template: 'inactivation_feedback', subject: 'A quick note from Interiors by DeX' },
  SLA_BREACH: { template: 'mom', subject: 'SLA Alert — Interiors by DeX' }, // reuses mom template
};

// ── Main send function ────────────────────────────────────────────────────────
export async function sendEmailByType(
  type: string,
  leadId: string,
  vars: Record<string, string>,
  to?: string,
): Promise<void> {
  const config = EMAIL_TEMPLATES[type];
  if (!config) throw new Error(`Unknown email type: ${type}`);

  const html = fillTemplate(config.template, vars);

  if (to) {
    await sendEmail({ to, subject: config.subject, html });
  }

  // Log the send
  if (to) {
    await prisma.emailLog.create({
      data: { leadId, type, sentTo: to, subject: config.subject },
    }).catch((e) => console.warn('[emailService] Log write failed:', e.message));
  }
}

// ── Preview: fills template without sending ───────────────────────────────────
export function previewEmail(type: string, vars: Record<string, string>): string {
  const config = EMAIL_TEMPLATES[type];
  if (!config) throw new Error(`Unknown email type: ${type}`);
  return fillTemplate(config.template, vars);
}

// ── Draft storage (in-memory for dev; use Redis/DB for prod) ─────────────────
interface DraftMeta { leadId: string; type: string }
const drafts = new Map<string, { subject: string; html: string; meta?: DraftMeta }>();

export function saveDraft(key: string, subject: string, html: string, meta?: DraftMeta) {
  // Preserve meta set at creation time (e.g. by meetings.ts) even if the
  // caller re-saving edited content (routes/email.ts PATCH /draft) doesn't
  // pass it again.
  const existingMeta = drafts.get(key)?.meta;
  drafts.set(key, { subject, html, meta: meta ?? existingMeta });
}

export function getDraft(key: string) {
  return drafts.get(key) ?? null;
}

export async function sendDraft(key: string, to: string): Promise<void> {
  const draft = drafts.get(key);
  if (!draft) throw new Error('Draft not found');

  await sendEmail({ to, subject: draft.subject, html: draft.html });
  drafts.delete(key);

  if (draft.meta) {
    await prisma.emailLog.create({
      data: { leadId: draft.meta.leadId, type: draft.meta.type, sentTo: to, subject: draft.subject },
    }).catch((e) => console.warn('[emailService] Log write failed:', e.message));
  }
}
