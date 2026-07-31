/**
 * Email helper — stubs for development.
 * Replace with Resend / SendGrid / Nodemailer in production.
 */

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    // TODO: integrate Resend / SendGrid
    console.warn('[email] Production email not yet configured. Payload:', payload);
  } else {
    console.log('[email:dev] Would send email:', {
      to: payload.to,
      subject: payload.subject,
    });
  }
}

// ── Pre-built templates ────────────────────────────────────────────────────────

export function meetingConfirmationEmail(opts: {
  clientName: string;
  type: string;
  mode: string;
  scheduledAt: Date;
  designerName: string;
}): EmailPayload {
  const dateStr = opts.scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  return {
    to: '',
    subject: `Meeting Confirmed — Interiors by DeX`,
    html: `<p>Dear ${opts.clientName},</p>
<p>Your <strong>${opts.type} meeting</strong> has been scheduled for <strong>${dateStr}</strong>.</p>
<p>Mode: ${opts.mode}<br/>Designer: ${opts.designerName}</p>
<p>Looking forward to meeting you!<br/><em>Team Interiors by DeX</em></p>`,
  };
}

export function momEmail(opts: {
  clientName: string;
  meetingType: string;
  scheduledAt: Date;
  mom: string;
}): EmailPayload {
  const dateStr = opts.scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  return {
    to: '',
    subject: `Minutes of Meeting — Interiors by DeX`,
    html: `<p>Dear ${opts.clientName},</p>
<p>Thank you for your time during our <strong>${opts.meetingType}</strong> on ${dateStr}.</p>
<p><strong>Meeting Summary:</strong></p>
<p>${opts.mom.replace(/\n/g, '<br/>')}</p>
<p>We'll be in touch with next steps.<br/><em>Team Interiors by DeX</em></p>`,
  };
}

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
