/**
 * Email helper — real delivery for all client-facing mail.
 * Send order: Resend (RESEND_API_KEY) → SMTP (SMTP_HOST/PORT/USER/PASS) →
 * dev-only console preview (jsonTransport) when NEITHER is configured, which
 * only happens outside production. This is the single choke point every
 * client-facing send route funnels through — fixing it here fixes all of
 * them (PD→OB, OB→OBM, meeting mails via the queue worker, next-plan mails,
 * lead-status mails) without touching each call site.
 */
import nodemailer from 'nodemailer';
import { sendViaResend } from './resendEmail.js';

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  contentType?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  cc?: string[];
  attachments?: EmailAttachment[];
}

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
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

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const from = process.env.FROM_EMAIL ?? 'noreply@interiorsbydex.com';
  const cc = payload.cc?.length ? payload.cc : undefined;

  const attachments = payload.attachments?.length ? payload.attachments : undefined;

  // 1) Resend — the configured, working integration. Preferred whenever a key exists.
  if (process.env.RESEND_API_KEY) {
    const result = await sendViaResend({ from, to: payload.to, subject: payload.subject, html: payload.html, cc, attachments });
    console.log(`[email:resend] Sent "${payload.subject}" → ${payload.to}${cc ? ` (cc: ${cc.join(', ')})` : ''}${attachments ? ` (${attachments.length} attachment(s))` : ''} (id: ${result.id})`);
    return;
  }

  // 2) SMTP — legacy path, still supported if explicitly configured.
  const isSmtpConfigured = !!process.env.SMTP_HOST;
  const nodemailerAttachments = attachments?.map((a) => ({
    filename: a.filename,
    content: a.content,
    encoding: 'base64' as const,
    contentType: a.contentType,
  }));
  if (isSmtpConfigured) {
    const transporter = getTransporter();
    await transporter.sendMail({ from, to: payload.to, cc, subject: payload.subject, html: payload.html, attachments: nodemailerAttachments });
    console.log(`[email:smtp] Sent "${payload.subject}" → ${payload.to}${cc ? ` (cc: ${cc.join(', ')})` : ''}${attachments ? ` (${attachments.length} attachment(s))` : ''}`);
    return;
  }

  // 3) Neither configured — this must never happen in production, where it
  // would silently drop a client-facing email. Fail loudly instead.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`No email provider configured (RESEND_API_KEY or SMTP_HOST) — refusing to silently drop "${payload.subject}" → ${payload.to}`);
  }
  const transporter = getTransporter();
  const info = await transporter.sendMail({ from, to: payload.to, cc, subject: payload.subject, html: payload.html, attachments: nodemailerAttachments });
  console.log(`[email:dev] No provider configured — NOT actually sent. Would send "${payload.subject}" → ${payload.to}${cc ? ` (cc: ${cc.join(', ')})` : ''}${attachments ? ` (${attachments.length} attachment(s))` : ''}`, JSON.parse(info.message).subject);
}

// ── Pre-built templates ────────────────────────────────────────────────────────

// meetingConfirmationEmail / momEmail moved to lib/mailTemplates.ts (Task #66)
// so their default subject/body are admin-editable from Settings.

export function noShowEmail(opts: { clientName: string }): EmailPayload {
  return {
    to: '',
    subject: `We Missed You — Interiors by DeX`,
    html: `<p>Dear ${opts.clientName},</p>
<p>We noticed you weren't able to make it to today's meeting. No worries!</p>
<p>Please reply to this email with your availability so we can reschedule at a time that works for you.</p>
<p>Looking forward to connecting!<br/><em>Team Interiors by DeX</em></p>`,
  };
}

export function rescheduleEmail(opts: {
  clientName: string;
  reason: string;
}): EmailPayload {
  return {
    to: '',
    subject: `Meeting Rescheduled — Interiors by DeX`,
    html: `<p>Dear ${opts.clientName},</p>
<p>Your meeting has been rescheduled. Reason: ${opts.reason}</p>
<p>Our team will reach out shortly to confirm the new time.<br/><em>Team Interiors by DeX</em></p>`,
  };
}

export function inactivationEmail(opts: {
  clientName: string;
  feedbackUrl: string;
  reason?: string;
}): EmailPayload {
  return {
    to: '',
    subject: `We'd love your feedback — Interiors by DeX`,
    html: `<p>Dear ${opts.clientName},</p>
<p>Thank you for your interest in Interiors by DeX.</p>
${opts.reason ? `<p>We understand that the project may not have moved forward at this time.</p>` : ''}
<p>We'd really appreciate a minute of your time to share your thoughts — it helps us improve:</p>
<p><a href="${opts.feedbackUrl}" style="background:#d95f32;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Share Feedback</a></p>
<p>Thank you!<br/><em>Team Interiors by DeX</em></p>`,
  };
}

export function stageMoveBackwardEmail(opts: {
  recipientName: string;
  leadId: string;
  leadName: string;
  fromStage: string;
  toStage: string;
  movedByName: string;
}): EmailPayload {
  return {
    to: '',
    subject: `Lead Moved Backward: ${opts.fromStage} → ${opts.toStage} — Interiors by DeX`,
    html: `<p>Hi ${opts.recipientName},</p>
<p>Lead <strong>${opts.leadId} — ${opts.leadName}</strong> has been moved backward in the sales funnel:</p>
<p><strong>${opts.fromStage} → ${opts.toStage}</strong></p>
<p>Moved by: ${opts.movedByName}</p>
<p>Please review this lead and take appropriate action.<br/><em>Team Interiors by DeX CRM</em></p>`,
  };
}

export function intentRatingChangedEmail(opts: {
  recipientName: string;
  leadId: string;
  leadName: string;
  oldRating: number | null;
  newRating: number;
  direction: 'increase' | 'decrease';
  changedByName: string;
  reason?: string;
}): EmailPayload {
  const dirWord = opts.direction === 'increase' ? 'increased' : 'decreased';
  return {
    to: '',
    subject: `Intent Rating ${opts.direction === 'increase' ? 'Increased ↑' : 'Decreased ↓'}: Lead ${opts.leadId} — Interiors by DeX`,
    html: `<p>Hi ${opts.recipientName},</p>
<p>The intent rating for lead <strong>${opts.leadId} — ${opts.leadName}</strong> has been <strong>${dirWord}</strong>:</p>
<p>${opts.oldRating ?? '—'} ★ → ${opts.newRating} ★</p>
${opts.reason ? `<p>Reason: ${opts.reason}</p>` : ''}
<p>Updated by: ${opts.changedByName}</p>
<p><em>Team Interiors by DeX CRM</em></p>`,
  };
}

export function noShowNoPlanEmail(opts: {
  recipientName: string;
  leadId: string;
  leadName: string;
  meetingType: string;
  noShowReason: string;
}): EmailPayload {
  return {
    to: '',
    subject: `⚠ Unplanned No-Show: Lead ${opts.leadId} — Interiors by DeX`,
    html: `<p>Hi ${opts.recipientName},</p>
<p><strong>${opts.leadName}</strong> (${opts.leadId}) was a no-show for their <strong>${opts.meetingType}</strong> meeting and has <strong>no follow-up meeting scheduled</strong>.</p>
<p><strong>No-show reason recorded:</strong> ${opts.noShowReason}</p>
<p>Please take immediate action — contact the client or rebook the meeting to keep the lead progressing.</p>
<p><em>Team Interiors by DeX CRM</em></p>`,
  };
}

export function onHoldInternalEmail(opts: {
  recipientName: string;
  leadId: string;
  leadName: string;
  revivalDate: string;
  reason: string;
  movedByName: string;
}): EmailPayload {
  return {
    to: '',
    subject: `Lead ${opts.leadId} placed On Hold — Interiors by DeX CRM`,
    html: `<p>Hi ${opts.recipientName},</p>
<p>Lead <strong>${opts.leadId} — ${opts.leadName}</strong> has been placed <strong>On Hold</strong>.</p>
<p><strong>Reason:</strong> ${opts.reason}<br/>
<strong>Revival Date:</strong> ${opts.revivalDate}<br/>
<strong>Actioned by:</strong> ${opts.movedByName}</p>
<p>The client has been notified automatically. No further action is needed until the revival date.</p>
<p><em>Team Interiors by DeX CRM</em></p>`,
  };
}

export function inactiveInternalEmail(opts: {
  recipientName: string;
  leadId: string;
  leadName: string;
  reason: string;
  movedByName: string;
}): EmailPayload {
  return {
    to: '',
    subject: `Lead ${opts.leadId} marked Inactive — Interiors by DeX CRM`,
    html: `<p>Hi ${opts.recipientName},</p>
<p>Lead <strong>${opts.leadId} — ${opts.leadName}</strong> has been marked <strong>Inactive</strong>.</p>
<p><strong>Reason:</strong> ${opts.reason}<br/>
<strong>Actioned by:</strong> ${opts.movedByName}</p>
<p>A feedback email and SMS have been sent to the client automatically.</p>
<p><em>Team Interiors by DeX CRM</em></p>`,
  };
}

export function leadReactivatedInternalEmail(opts: {
  recipientName: string;
  leadId: string;
  leadName: string;
  fromStatus: string;
  reason: string;
  notes?: string;
  reactivatedByName: string;
}): EmailPayload {
  return {
    to: '',
    subject: `Lead ${opts.leadId} reactivated — Interiors by DeX CRM`,
    html: `<p>Hi ${opts.recipientName},</p>
<p>Lead <strong>${opts.leadId} — ${opts.leadName}</strong> has been reactivated from <strong>${opts.fromStatus}</strong>.</p>
<p><strong>Reason:</strong> ${opts.reason}${opts.notes ? `<br/><strong>Notes:</strong> ${opts.notes}` : ''}<br/>
<strong>Actioned by:</strong> ${opts.reactivatedByName}</p>
<p><em>Team Interiors by DeX CRM</em></p>`,
  };
}

export function leadReactivatedClientEmail(opts: {
  clientName: string;
  notes?: string;
}): EmailPayload {
  return {
    to: '',
    subject: `Your Project is Back On Track — Interiors by DeX`,
    html: `<p>Dear ${opts.clientName},</p>
<p>Good news — your interior design project with <strong>Interiors by DeX</strong> is now active again and our team will be in touch shortly.</p>
${opts.notes ? `<p>${opts.notes}</p>` : ''}
<p>Thank you for your patience!<br/><em>Team Interiors by DeX</em></p>`,
  };
}

export function npsEmail(opts: {
  clientName: string;
  stageName: string;
  ratingUrl: string;
  designerName: string;
}): EmailPayload {
  const scores = Array.from({ length: 11 }, (_, i) => i);
  const scoreLinks = scores.map((i) => {
    const bg = i <= 6 ? '#f0ece8' : i <= 8 ? '#f59e0b' : '#22c55e';
    const color = i <= 6 ? '#6b7280' : '#fff';
    return `<a href="${opts.ratingUrl}?score=${i}" style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:${bg};color:${color};border-radius:8px;text-decoration:none;margin:2px;font-size:13px;font-weight:700">${i}</a>`;
  }).join('');

  return {
    to: '',
    subject: `Quick feedback on your ${opts.stageName} experience — Interiors by DeX`,
    html: `<p>Dear ${opts.clientName},</p>
<p>Your <strong>${opts.stageName}</strong> milestone with Interiors by DeX is complete — congratulations! 🎉</p>
<p>We'd love to know: on a scale of <strong>0–10</strong>, how likely are you to recommend us to a friend or family?</p>
<p style="text-align:center;margin:24px 0;">${scoreLinks}</p>
<p style="text-align:center;font-size:12px;color:#9ca3af;">0 = Not at all likely &nbsp;&nbsp;&nbsp; 10 = Extremely likely</p>
<p>Or tap here to open the survey: <a href="${opts.ratingUrl}" style="color:#d95f32">${opts.ratingUrl}</a></p>
<p>Thank you for trusting us with your space!<br/><em>Team Interiors by DeX</em></p>`,
  };
}

export function onHoldEmail(opts: {
  clientName: string;
  revivalDate: string;
  reason: string;
}): EmailPayload {
  return {
    to: '',
    subject: `Your Project is On Hold — Interiors by DeX`,
    html: `<p>Dear ${opts.clientName},</p>
<p>We wanted to let you know that your interior design project with <strong>Interiors by DeX</strong> has been placed on hold.</p>
<p><strong>Revival Date:</strong> ${opts.revivalDate}<br/>
<strong>Reason:</strong> ${opts.reason}</p>
<p>We will reach out to you on or before the revival date to resume the project. In the meantime, feel free to contact us with any questions.</p>
<p>Thank you for your patience!<br/><em>Team Interiors by DeX</em></p>`,
  };
}
