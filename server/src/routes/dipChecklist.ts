/**
 * DIP Checklist routes
 *
 * GET   /api/leads/:id/dip-checklist    — get checklist state
 * PATCH /api/leads/:id/dip-checklist    — update checklist (BL only)
 */

import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';

export const dipChecklistRouter = Router({ mergeParams: true });

// ── GET /api/leads/:id/dip-checklist ─────────────────────────────────────────
dipChecklistRouter.get('/', verifyToken, async (req, res) => {
  try {
    const { leadId: id } = req.params;
    const checklist = await prisma.dIPChecklist.findUnique({ where: { leadId: id } });
    res.json({ checklist: checklist ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id/dip-checklist ───────────────────────────────────────
dipChecklistRouter.patch('/', verifyToken, requireRole('BL'), async (req, res) => {
  try {
    const { leadId: id } = req.params;
    const user = req.user!;
    const {
      welcomeMailSent,
      discountApprovalFormSent,
      npsTriggered,
      cxApprovalReceived,
      internalMailThreadCompleted,
      internalMailThreadUrl,
    } = req.body as {
      welcomeMailSent?: boolean;
      discountApprovalFormSent?: boolean;
      npsTriggered?: boolean;
      cxApprovalReceived?: boolean;
      internalMailThreadCompleted?: boolean;
      internalMailThreadUrl?: string;
    };

    const current = await prisma.dIPChecklist.findUnique({ where: { leadId: id } });
    if (!current) {
      res.status(404).json({ error: 'DIP checklist not found. Lead may not be in ONBOARDING stage yet.' });
      return;
    }

    const updateData: any = {};
    if (welcomeMailSent !== undefined) updateData.welcomeMailSent = welcomeMailSent;
    if (discountApprovalFormSent !== undefined) updateData.discountApprovalFormSent = discountApprovalFormSent;
    if (npsTriggered !== undefined) updateData.npsTriggered = npsTriggered;
    if (cxApprovalReceived !== undefined) updateData.cxApprovalReceived = cxApprovalReceived;
    if (internalMailThreadCompleted !== undefined) updateData.internalMailThreadCompleted = internalMailThreadCompleted;
    if (internalMailThreadUrl !== undefined) updateData.internalMailThreadUrl = internalMailThreadUrl;

    // Check if all 5 booleans will be true after update
    const merged = { ...current, ...updateData };
    const allComplete =
      merged.welcomeMailSent &&
      merged.discountApprovalFormSent &&
      merged.npsTriggered &&
      merged.cxApprovalReceived &&
      merged.internalMailThreadCompleted;

    if (allComplete && !current.completedAt) {
      updateData.completedAt = new Date();
    }

    const checklist = await prisma.dIPChecklist.update({
      where: { leadId: id },
      data: updateData,
    });

    await logActivity(user.id, 'DIP_CHECKLIST_UPDATED', id, updateData);

    // Notify Branch Head when completed
    if (allComplete && !current.completedAt) {
      const branchHeads = await prisma.user.findMany({
        where: { role: 'BRANCH_HEAD', isActive: true },
        select: { id: true },
      });
      const lead = await prisma.lead.findUnique({
        where: { id },
        select: { leadId: true, name: true },
      });
      for (const bh of branchHeads) {
        await createNotification(
          bh.id,
          'DIP_CHECKLIST_COMPLETE',
          `DIP checklist complete for ${lead?.leadId ?? id} (${lead?.name ?? ''}). Sales task can be closed.`,
          id,
        );
      }
    }

    res.json({ checklist });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
