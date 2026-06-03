import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates/email');

// ── Nodemailer transporter (lazy) ─────────────────────────────────────────────
let _transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // Return a dev preview transporter
    _transporter = nodemailer.createTransport({ jsonTransport: true });
    return _transporter;
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return _transporter;
}

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
  const from = process.env.FROM_EMAIL ?? 'noreply@interiorsbydex.com';

  const transporter = getTransporter();
  const isDevTransport = !process.env.SMTP_HOST;

  if (isDevTransport) {
    console.log(`[email:dev] Would send "${config.subject}" to ${to ?? '(no recipient)'}`);
  } else if (to) {
    await transporter.sendMail({ from, to, subject: config.subject, html });
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
const drafts = new Map<string, { subject: string; html: string }>();

export function saveDraft(key: string, subject: string, html: string) {
  drafts.set(key, { subject, html });
}

export function getDraft(key: string) {
  return drafts.get(key) ?? null;
}

export async function sendDraft(key: string, to: string, from?: string): Promise<void> {
  const draft = drafts.get(key);
  if (!draft) throw new Error('Draft not found');

  const transporter = getTransporter();
  const fromAddr = from ?? process.env.FROM_EMAIL ?? 'noreply@interiorsbydex.com';

  if (!process.env.SMTP_HOST) {
    console.log(`[email:dev] Would send draft "${draft.subject}" to ${to}`);
  } else {
    await transporter.sendMail({ from: fromAddr, to, subject: draft.subject, html: draft.html });
  }
  drafts.delete(key);
}
