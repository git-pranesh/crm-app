import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';
import { previewEmail, saveDraft, getDraft, sendDraft } from '../lib/emailService.js';

export const emailRouter = Router();

// ── GET /api/email/preview/:type/:leadId ──────────────────────────────────────
emailRouter.get('/preview/:type/:leadId', verifyToken, async (req, res) => {
  const { type, leadId } = req.params;
  const user = req.user!;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      meetings: { where: { status: 'COMPLETED' }, orderBy: { scheduledAt: 'desc' }, take: 1 },
      assignedDesigner: { select: { name: true } },
    },
  });
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

  const latestMeeting = lead.meetings[0];

  const vars: Record<string, string> = {
    clientName: lead.name,
    clientEmail: lead.email ?? '',
    designerName: lead.assignedDesigner?.name ?? 'Your Designer',
    meetingType: latestMeeting?.type ?? '',
    ppNumber: latestMeeting?.ppNumber ? `PP${latestMeeting.ppNumber}` : '',
    scheduledAt: latestMeeting
      ? new Date(latestMeeting.scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : '',
    mom: (latestMeeting as any)?.mom ?? '',
    rescheduledReason: (latestMeeting as any)?.rescheduledReason ?? '',
    feedbackLink: '',
  };

  const html = previewEmail(type, vars);

  // Log that this user previewed the email
  await prisma.emailLog.create({
    data: {
      leadId,
      type: `PREVIEW_${type}`,
      sentTo: lead.email ?? '',
      subject: `Preview by ${user.name}`,
      previewedById: user.id,
    },
  }).catch(() => {});

  res.json({ html, vars });
});

// ── PATCH /api/email/draft/:type/:leadId ──────────────────────────────────────
emailRouter.patch('/draft/:type/:leadId', verifyToken, async (req, res) => {
  const { type, leadId } = req.params;
  const { html, subject } = req.body as { html?: string; subject?: string };

  if (!html) { res.status(400).json({ error: 'html is required' }); return; }

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, email: true, name: true },
  });
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

  const draftKey = `${leadId}::${type}`;
  saveDraft(draftKey, subject ?? `${type} — Interiors by DeX`, html);

  res.json({ message: 'Draft saved', draftKey });
});

// ── POST /api/email/send-draft ────────────────────────────────────────────────
emailRouter.post('/send-draft', verifyToken, async (req, res) => {
  const { draftKey, to } = req.body as { draftKey?: string; to?: string };

  if (!draftKey || !to) { res.status(400).json({ error: 'draftKey and to are required' }); return; }

  const draft = getDraft(draftKey);
  if (!draft) { res.status(404).json({ error: 'Draft not found or expired' }); return; }

  await sendDraft(draftKey, to);

  res.json({ message: `Email sent to ${to}` });
});
