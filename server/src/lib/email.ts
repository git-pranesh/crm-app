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
