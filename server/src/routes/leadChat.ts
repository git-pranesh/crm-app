import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';

/**
 * Internal team chat for a lead — separate from the client-facing WhatsApp
 * thread (`whatsapp.ts`) and separate from the audit-trail Activity Log
 * (`activityLog.ts`). Messages here are just team notes/discussion and are
 * intentionally NOT written to ActivityLog, so they never affect how
 * individual activities are logged or the Activity feed's timeline.
 */
export const leadChatRouter = Router({ mergeParams: true });

// ── GET /api/leads/:leadId/chat — full thread, oldest first ──────────────────
leadChatRouter.get('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

  const messages = await prisma.leadChatMessage.findMany({
    where: { leadId },
    include: { user: { select: { id: true, name: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  });

  res.json({ messages });
});

// ── POST /api/leads/:leadId/chat — post a new message ─────────────────────────
leadChatRouter.post('/', verifyToken, async (req, res) => {
  const { leadId } = req.params as { leadId: string };
  const user = req.user!;
  const { body } = req.body as { body?: string };

  if (!body || !body.trim()) { res.status(400).json({ error: 'body is required' }); return; }

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }

  const message = await prisma.leadChatMessage.create({
    data: { leadId, userId: user.id, body: body.trim() },
    include: { user: { select: { id: true, name: true, role: true } } },
  });

  res.status(201).json({ message });
});
