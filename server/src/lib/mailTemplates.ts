/**
 * Admin-editable mail template registry (Task #66).
 *
 * Every system-triggered email that previously had a hardcoded default
 * subject/body is registered here with a code, a human label, and a list of
 * `{{placeholder}}` tokens available to admins when editing it. Admin
 * overrides are stored as a single JSON blob on AssignmentConfig (the same
 * generic key-value config table used for SLA threshold overrides), keyed by
 * template code. When no override exists, the hardcoded default is used —
 * so this is purely additive and never breaks a fresh install.
 *
 * Per-send editable modals (PD→OB "Share welcome mail", OB→OBM "Share OBM
 * mail") already let a user tweak the wording for one send; this registry
 * controls what they see pre-filled by default.
 */
import { prisma } from './prisma.js';

export interface MailTemplateDef {
  code: string;
  label: string;
  description: string;
  placeholders: string[];
  defaultSubject: string;
  defaultHtml: string;
}

export const MAIL_TEMPLATES: MailTemplateDef[] = [
  {
    code: 'PD_OB_WELCOME',
    label: 'Welcome mail (Proposal Discussion → Onboarding)',
    description: 'Sent when the PD→OB checklist is completed and the lead moves to Onboarding.',
    placeholders: ['clientName'],
    defaultSubject: 'Welcome Onboard — Interiors by DeX',
    defaultHtml: `<p>Dear {{clientName}},</p>
<p>Congratulations and welcome aboard! We're thrilled to begin your interior design journey with <strong>Interiors by DeX</strong>.</p>
<p>Our onboarding team will be in touch shortly with the next steps, including your onboarding meeting.</p>
<p>Thank you for choosing us — we can't wait to bring your space to life!<br/><em>Team Interiors by DeX</em></p>`,
  },
  {
    code: 'OB_OBM_WELCOME',
    label: 'OBM mail (Onboarding → Onboarding Meeting)',
    description: 'Sent when the OB→OBM checklist is completed and the lead moves to Onboarding Meeting.',
    placeholders: ['clientName', 'timeline'],
    defaultSubject: 'Your Onboarding is Complete — Interiors by DeX',
    defaultHtml: `<p>Dear {{clientName}},</p>
<p>Great news — your onboarding with <strong>Interiors by DeX</strong> is now complete!</p>
<p>Your dedicated design team will reach out shortly to kick off the design process. Here's your project timeline:</p>
{{timeline}}
<p>Thank you for your trust — we're excited to get started!<br/><em>Team Interiors by DeX</em></p>`,
  },
  {
    code: 'MEETING_CONFIRMATION',
    label: 'Meeting confirmation',
    description: 'Sent automatically whenever a meeting is scheduled.',
    placeholders: ['clientName', 'type', 'mode', 'scheduledAt', 'designerName'],
    defaultSubject: 'Meeting Confirmed — Interiors by DeX',
    defaultHtml: `<p>Dear {{clientName}},</p>
<p>Your <strong>{{type}} meeting</strong> has been scheduled for <strong>{{scheduledAt}}</strong>.</p>
<p>Mode: {{mode}}<br/>Designer: {{designerName}}</p>
<p>Looking forward to meeting you!<br/><em>Team Interiors by DeX</em></p>`,
  },
  {
    code: 'MOM',
    label: 'Minutes of Meeting (MOM)',
    description: 'Sent automatically when a meeting is marked Completed.',
    placeholders: ['clientName', 'meetingType', 'scheduledAt', 'mom'],
    defaultSubject: 'Minutes of Meeting — Interiors by DeX',
    defaultHtml: `<p>Dear {{clientName}},</p>
<p>Thank you for your time during our <strong>{{meetingType}}</strong> on {{scheduledAt}}.</p>
<p><strong>Meeting Summary:</strong></p>
<p>{{mom}}</p>
<p>We'll be in touch with next steps.<br/><em>Team Interiors by DeX</em></p>`,
  },
];

const MAIL_TEMPLATE_CONFIG_KEY = 'mail_template_overrides';

type Overrides = Record<string, { subject?: string; html?: string }>;

export async function getMailTemplateOverrides(): Promise<Overrides> {
  const row = await prisma.assignmentConfig.findUnique({ where: { key: MAIL_TEMPLATE_CONFIG_KEY } });
  return (row?.value as Overrides) ?? {};
}

/** Full list with each template's effective (override-aware) default subject/html, unfilled placeholders intact. */
export async function getEffectiveMailTemplates(): Promise<(MailTemplateDef & { subject: string; html: string })[]> {
  const overrides = await getMailTemplateOverrides();
  return MAIL_TEMPLATES.map((t) => ({
    ...t,
    subject: overrides[t.code]?.subject?.trim() || t.defaultSubject,
    html: overrides[t.code]?.html?.trim() || t.defaultHtml,
  }));
}

export async function setMailTemplateOverride(code: string, subject: string, html: string): Promise<void> {
  const def = MAIL_TEMPLATES.find((t) => t.code === code);
  if (!def) throw new Error(`Unknown mail template: ${code}`);
  const overrides = await getMailTemplateOverrides();
  overrides[code] = { subject: subject.trim(), html: html.trim() };
  await prisma.assignmentConfig.upsert({
    where: { key: MAIL_TEMPLATE_CONFIG_KEY },
    create: { key: MAIL_TEMPLATE_CONFIG_KEY, value: overrides as any },
    update: { value: overrides as any },
  });
}

export async function resetMailTemplateOverride(code: string): Promise<void> {
  const overrides = await getMailTemplateOverrides();
  delete overrides[code];
  await prisma.assignmentConfig.upsert({
    where: { key: MAIL_TEMPLATE_CONFIG_KEY },
    create: { key: MAIL_TEMPLATE_CONFIG_KEY, value: overrides as any },
    update: { value: overrides as any },
  });
}

function fillPlaceholders(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/** Effective (override-aware) subject+html for one template, with `{{placeholders}}` filled from `vars`. */
export async function renderMailTemplate(code: string, vars: Record<string, string>): Promise<{ subject: string; html: string }> {
  const def = MAIL_TEMPLATES.find((t) => t.code === code);
  if (!def) throw new Error(`Unknown mail template: ${code}`);
  const overrides = await getMailTemplateOverrides();
  const subject = overrides[code]?.subject?.trim() || def.defaultSubject;
  const html = overrides[code]?.html?.trim() || def.defaultHtml;
  return { subject: fillPlaceholders(subject, vars), html: fillPlaceholders(html, vars) };
}
