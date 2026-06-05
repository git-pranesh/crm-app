import { randomUUID } from 'crypto';
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken, requireRole } from '../middleware/auth.js';
import { logActivity } from '../lib/activityLog.js';
import { createNotification } from '../lib/notifications.js';
import { sendSms } from '../services/smsService.js';
import { sendEmail, inactivationEmail, onHoldEmail } from '../lib/email.js';
import { sendWhatsAppMessage, fillTemplate } from '../lib/whatsapp.js';
import { selectBLForLead } from '../services/assignmentService.js';

export const leadsRouter = Router();

// ── Auto-generate X#### lead ID ───────────────────────────────────────────────
async function generateLeadId(): Promise<string> {
  const counter = await prisma.$transaction(async (tx) => {
    return tx.leadCounter.upsert({
      where: { id: 1 },
      create: { id: 1, lastNum: 1 },
      update: { lastNum: { increment: 1 } },
    });
  });
  return `X${String(counter.lastNum).padStart(4, '0')}`;
}

const LEAD_INCLUDE = {
  assignedDesigner: { select: { id: true, name: true, role: true } },
  assignedBL: { select: { id: true, name: true } },
  currentOffer: { select: { id: true, name: true } },
  _count: { select: { calls: true, meetings: true, followUpTasks: true } },
} as const;

// ── GET /api/leads — list with filters + pagination ───────────────────────────
leadsRouter.get('/', verifyToken, async (req, res) => {
  try {
    const {
      stage, source, designerId, blId, search,
      isSLABreached, page = '1', limit = '50',
      projectType, location, dateRange, intent,
    } = req.query as Record<string, string>;

    const user = req.user!;
    const where: any = {};

    // Role-scope — G3: DESIGNER and CRE have separate clauses
    if (user.role === 'DESIGNER') {
      where.assignedDesignerId = user.id;
    } else if (user.role === 'CRE') {
      where.OR = [
        { assignedDesignerId: user.id },
        { createdById: user.id },
      ];
    } else if (user.role === 'BL') {
      const members = await prisma.user.findMany({
        where: { blId: user.id, isActive: true },
        select: { id: true },
      });
      // BL sees leads assigned to their team OR directly assigned to them as BL
      where.AND = [
        {
          OR: [
            { assignedDesignerId: { in: [user.id, ...members.map((m) => m.id)] } },
            { assignedBLId: user.id },
          ],
        },
      ];
    }

    if (stage) where.stage = stage;
    if (source) where.source = source;
    if (designerId) where.assignedDesignerId = designerId;
    if (blId) where.assignedBLId = blId;
    if (isSLABreached === 'true') where.isSLABreached = true;
    // G2: new filter params
    if (projectType) where.projectType = projectType;
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (intent) where.intentRating = parseInt(intent);
    if (dateRange) {
      const [from, to] = (dateRange as string).split(',');
      where.createdAt = { gte: new Date(from), lte: new Date(to) };
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { leadId: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: LEAD_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ leads, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
  } catch (err: any) {
    console.error('[leads:list]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads — create lead ─────────────────────────────────────────────
leadsRouter.post('/', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const {
      name, phone, phone2, email, source, adName,
      utmCampaign, utmAdSet, utmSource,
      projectType, scope, location, possessionTimeline,
      estimatedValue, intentRating,
      assignedDesignerId, assignedBLId,
    } = req.body as Record<string, string>;

    if (!name?.trim() || !phone?.trim()) {
      res.status(400).json({ error: 'name and phone are required' });
      return;
    }

    // Check duplicate phone
    const existing = await prisma.lead.findFirst({ where: { phone } });
    if (existing) {
      res.status(409).json({ error: 'A lead with this phone number already exists', existingLeadId: existing.id });
      return;
    }

    const leadId = await generateLeadId();

    const lead = await prisma.lead.create({
      data: {
        leadId,
        name: name.trim(),
        phone: phone.trim(),
        phone2: phone2?.trim() || undefined,
        email: email?.trim() || undefined,
        source: source?.trim() || undefined,
        adName: adName?.trim() || undefined,
        utmCampaign: utmCampaign?.trim() || undefined,
        utmAdSet: utmAdSet?.trim() || undefined,
        utmSource: utmSource?.trim() || undefined,
        projectType: projectType?.trim() || undefined,
        scope: scope?.trim() || undefined,
        location: location?.trim() || undefined,
        possessionTimeline: possessionTimeline?.trim() || undefined,
        estimatedValue: estimatedValue ? parseFloat(estimatedValue) : undefined,
        intentRating: intentRating ? parseInt(intentRating) : undefined,
        // Auto-assign to creator based on role
        assignedDesignerId: assignedDesignerId || (['CRE', 'DESIGNER'].includes(user.role) ? user.id : undefined),
        assignedBLId: assignedBLId || (user.role === 'BL' ? user.id : (['CRE', 'DESIGNER'].includes(user.role) && user.blId ? user.blId : undefined)),
        createdById: user.id,
        stage: 'EFFECTIVE_LEAD',
      },
      include: LEAD_INCLUDE,
    });

    await logActivity(user.id, 'LEAD_CREATED', lead.id, { leadId, source });

    res.status(201).json({ lead });
  } catch (err: any) {
    console.error('[leads:create]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/leads/manual — create lead manually (CRE / BL / BRANCH_HEAD) ────
leadsRouter.post(
  '/manual',
  verifyToken,
  requireRole('CRE', 'BL', 'BRANCH_HEAD'),
  async (req, res) => {
    try {
      const user = req.user!;
      const { name, phone, phone2, email, source, designerId } = req.body as {
        name?: string;
        phone?: string;
        phone2?: string;
        email?: string;
        source?: string;
        designerId?: string;
      };

      if (!name?.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      if (!phone?.trim()) {
        res.status(400).json({ error: 'phone is required' });
        return;
      }

      const ALLOWED_SOURCES = ['Walk-in', 'Referral', 'Manual'] as const;
      if (!source || !(ALLOWED_SOURCES as readonly string[]).includes(source)) {
        res.status(400).json({ error: `source must be one of: ${ALLOWED_SOURCES.join(' | ')}` });
        return;
      }

      // Duplicate check — phone
      const phoneMatch = await prisma.lead.findFirst({ where: { phone: phone.trim() } });
      if (phoneMatch) {
        res.status(409).json({
          isDuplicate: true,
          error: 'A lead with this phone number already exists',
          existingLeadId: phoneMatch.leadId,
          warning: `Phone ${phone.trim()} is already registered as lead ${phoneMatch.leadId}`,
        });
        return;
      }

      // Duplicate check — email (if provided)
      if (email?.trim()) {
        const emailMatch = await prisma.lead.findFirst({ where: { email: email.trim() } });
        if (emailMatch) {
          res.status(409).json({
            isDuplicate: true,
            error: 'A lead with this email already exists',
            existingLeadId: emailMatch.leadId,
            warning: `Email ${email.trim()} is already registered as lead ${emailMatch.leadId}`,
          });
          return;
        }
      }

      // Assignment logic
      let assignedDesignerId: string | undefined;
      let assignedBLId: string | undefined;

      if (user.role === 'CRE') {
        assignedDesignerId = user.id;
      } else if (user.role === 'BL') {
        assignedBLId = user.id;
        if (designerId) {
          const designer = await prisma.user.findUnique({
            where: { id: designerId },
            select: { id: true, blId: true },
          });
          if (!designer) { res.status(404).json({ error: 'Designer not found' }); return; }
          if (designer.blId !== user.id) {
            res.status(403).json({ error: 'Designer is not on your team' });
            return;
          }
          assignedDesignerId = designerId;
        }
      } else if (user.role === 'BRANCH_HEAD' && designerId) {
        const designer = await prisma.user.findUnique({
          where: { id: designerId },
          select: { id: true, blId: true },
        });
        if (!designer) { res.status(404).json({ error: 'Designer not found' }); return; }
        assignedDesignerId = designerId;
        if (designer.blId) assignedBLId = designer.blId;
      }

      const leadId = await generateLeadId();

      const lead = await prisma.lead.create({
        data: {
          leadId,
          name: name.trim(),
          phone: phone.trim(),
          ...(phone2?.trim() && { phone2: phone2.trim() }),
          ...(email?.trim() && { email: email.trim() }),
          source,
          stage: 'EFFECTIVE_LEAD',
          assignmentPath: 'DIRECT',
          createdById: user.id,
          ...(assignedDesignerId && { assignedDesignerId }),
          ...(assignedBLId && { assignedBLId }),
        },
        include: LEAD_INCLUDE,
      });

      await logActivity(user.id, 'LEAD_CREATED_MANUAL', lead.id, {
        leadId,
        source,
        createdByRole: user.role,
        ...(assignedDesignerId && { assignedDesignerId }),
      });

      res.status(201).json({ lead });
    } catch (err: any) {
      console.error('[leads:manual]', err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ── GET /api/leads/:id — get lead detail ──────────────────────────────────────
leadsRouter.get('/:id', verifyToken, async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        ...LEAD_INCLUDE,
        contacts: true,
        currentOffer: true,
        discountRequests: {
          include: {
            requestedBy: { select: { id: true, name: true } },
            reviewedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        slaBreaches: { where: { resolvedAt: null } },
        leadOffers: { include: { offer: { select: { id: true, name: true } } }, orderBy: { appliedAt: 'desc' } },
        emailLogs: { orderBy: { sentAt: 'desc' }, take: 50 },
        smsLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    res.json({ lead });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id — update lead ───────────────────────────────────────
leadsRouter.patch('/:id', verifyToken, async (req, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const {
      name, phone, phone2, email, source,
      stage, projectType, scope, location,
      estimatedValue, intentRating, possessionTimeline,
      assignedDesignerId, assignedBLId,
      onHoldRevivalDate, customFields,
      inactivationReason,
      reason,
    } = req.body as Record<string, any>;

    const existing = await prisma.lead.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: 'Lead not found' }); return; }

    const prevStage = existing.stage;

    // ── DIP gate: block ONBOARDING → HANDED_OVER without complete DIP checklist ─
    if (stage === 'HANDED_OVER' && prevStage === 'ONBOARDING') {
      const dip = await prisma.dIPChecklist.findUnique({ where: { leadId: id } });
      if (!dip?.completedAt) {
        res.status(409).json({ error: 'Complete DIP checklist before closing the sales task.' });
        return;
      }
    }

    const lead = await prisma.lead.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(phone && { phone }),
        ...(phone2 !== undefined && { phone2: phone2 || null }),
        ...(email !== undefined && { email: email || null }),
        ...(source && { source }),
        ...(stage && { stage: stage as any }),
        ...(projectType && { projectType }),
        ...(scope && { scope }),
        ...(location && { location }),
        ...(estimatedValue && { estimatedValue: parseFloat(estimatedValue) }),
        ...(intentRating && { intentRating: parseInt(intentRating) }),
        ...(possessionTimeline && { possessionTimeline }),
        ...(assignedDesignerId !== undefined && { assignedDesignerId: assignedDesignerId || null }),
        ...(assignedBLId !== undefined && { assignedBLId: assignedBLId || null }),
        ...(onHoldRevivalDate && { onHoldRevivalDate: new Date(onHoldRevivalDate) }),
        ...(customFields && {
          customFields: { ...(existing.customFields as Record<string, unknown> ?? {}), ...customFields },
        }),
      },
      include: LEAD_INCLUDE,
    });

    // Notify BL when assigned to a lead
    const newBLId = assignedBLId !== undefined ? (assignedBLId || null) : undefined;
    if (newBLId && newBLId !== existing.assignedBLId) {
      await createNotification(
        newBLId,
        'BL_ASSIGNED',
        `You have been assigned as BL for lead ${existing.leadId} — ${existing.name}`,
        id,
      );
      await logActivity(user.id, 'BL_ASSIGNED', id, { blId: newBLId });
    }

    if (stage && stage !== prevStage) {
      await logActivity(user.id, 'STAGE_CHANGED', id, { from: prevStage, to: stage });

      // Auto-create DIPChecklist when moving to ONBOARDING
      if (stage === 'ONBOARDING') {
        await prisma.dIPChecklist.upsert({
          where: { leadId: id },
          create: { leadId: id },
          update: {},
        });
        if (existing.assignedBLId) {
          await createNotification(
            existing.assignedBLId,
            'ONBOARDING_DIP_REQUIRED',
            `Lead ${existing.leadId} onboarded — complete DIP checklist to close the sales task`,
            id,
          );
        }
      }

      // G5: Auto-assign BL when CRE moves lead to MQL and no BL is set
      if (stage === 'MQL' && !lead.assignedBLId) {
        const bl = await selectBLForLead();
        if (bl) {
          await prisma.lead.update({
            where: { id },
            data: { assignedBLId: bl.id },
          });
          await prisma.user.update({
            where: { id: bl.id },
            data: { totalLeadsAssigned: { increment: 1 } },
          });
          await createNotification(
            bl.id,
            'BL_ASSIGNED',
            `You have been assigned as BL for lead ${existing.leadId} — ${existing.name}`,
            id,
          );
          await logActivity(user.id, 'BL_ASSIGNED', id, { blId: bl.id });
        }
      }

      // ON_HOLD notifications — SMS, Email, WhatsApp (all independent)
      if (stage === 'ON_HOLD' && existing.phone) {
        const revivalStr = onHoldRevivalDate
          ? new Date(onHoldRevivalDate).toLocaleDateString('en-IN')
          : 'a future date';
        const holdReason = reason ?? 'To be confirmed';

        sendSms(
          existing.phone,
          `Hi ${existing.name}, your Interiors by DeX project has been put on hold until ${revivalStr}. We'll be in touch. - Interiors by DeX`,
          id,
        ).catch((e) => console.warn('[leads:sms:on_hold]', e.message));

        // G1: Email
        if (existing.email) {
          try {
            const emailPayload = onHoldEmail({
              clientName: existing.name,
              revivalDate: revivalStr,
              reason: holdReason,
            });
            emailPayload.to = existing.email;
            await sendEmail(emailPayload);
            await prisma.emailLog.create({
              data: {
                leadId: id,
                type: 'ON_HOLD',
                sentTo: existing.email,
                subject: emailPayload.subject,
              },
            });
          } catch (e) {
            console.error('[ON_HOLD email failed]', e);
          }
        }

        // G1: WhatsApp
        try {
          const waBody = fillTemplate('on_hold_notification', {
            clientName: existing.name,
            revivalDate: revivalStr,
            reason: holdReason,
          });
          const twilioSid = await sendWhatsAppMessage(existing.phone, waBody);
          await prisma.whatsAppMessage.create({
            data: {
              leadId: id,
              direction: 'OUTBOUND',
              body: waBody,
              templateId: 'on_hold_notification',
              twilioSid: twilioSid ?? undefined,
            },
          });
        } catch (e) {
          console.error('[ON_HOLD whatsapp failed]', e);
        }
      }

      // INACTIVE — create feedback record, send email + SMS
      if (stage === 'INACTIVE') {
        const formToken = randomUUID();
        const baseUrl = process.env.BASE_URL ?? '';
        const feedbackUrl = `${baseUrl}/feedback/${formToken}`;

        await prisma.inactivationFeedback.upsert({
          where: { leadId: id },
          create: {
            leadId: id,
            reason: inactivationReason ?? 'Not specified',
            formToken,
            feedbackFormSentAt: new Date(),
          },
          update: {
            reason: inactivationReason ?? 'Not specified',
            formToken,
            feedbackFormSentAt: new Date(),
            respondedAt: null,
            clientResponse: null,
          },
        });

        if (existing.email) {
          const emailPayload = inactivationEmail({
            clientName: existing.name,
            feedbackUrl,
            reason: inactivationReason,
          });
          emailPayload.to = existing.email;
          sendEmail(emailPayload).catch((e) => console.warn('[leads:email:inactive]', e.message));

          await prisma.emailLog.create({
            data: {
              leadId: id,
              type: 'INACTIVATION_FEEDBACK',
              sentTo: existing.email,
              subject: emailPayload.subject,
            },
          });
        }

        if (existing.phone) {
          sendSms(
            existing.phone,
            `Hi ${existing.name}, thank you for your interest in Interiors by DeX. We'd love your feedback: ${feedbackUrl} - Interiors by DeX`,
            id,
          ).catch((e) => console.warn('[leads:sms:inactive]', e.message));
        }
      }
    }

    res.json({ lead });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/leads/:id/assign-direct — BL direct designer assignment ────────
leadsRouter.patch('/:id/assign-direct', verifyToken, requireRole('BL'), async (req, res) => {
  try {
    const user = req.user!;
    const { id } = req.params;
    const { designerId } = req.body as { designerId?: string };

    if (!designerId) {
      res.status(400).json({ error: 'designerId is required' });
      return;
    }

    const [lead, designer] = await Promise.all([
      prisma.lead.findUnique({ where: { id }, select: { id: true, leadId: true } }),
      prisma.user.findUnique({ where: { id: designerId }, select: { id: true, name: true, blId: true } }),
    ]);

    if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
    if (!designer) { res.status(404).json({ error: 'Designer not found' }); return; }

    // Verify designer is on this BL's team
    if (designer.blId !== user.id) {
      res.status(403).json({ error: 'Designer is not on your team' });
      return;
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: {
        assignedDesignerId: designerId,
        assignmentPath: 'DIRECT',
      },
      include: LEAD_INCLUDE,
    });

    // Notify the assigned designer
    await createNotification(
      designerId,
      'DESIGNER_ASSIGNED',
      `You have been assigned lead ${lead.leadId} by ${user.name}`,
      id,
    );

    await logActivity(user.id, 'DIRECT_ASSIGNMENT', id, {
      designerName: designer.name,
      assignedById: user.id,
    });

    res.json({ lead: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/leads/:id/activity ────────────────────────────────────────────────
leadsRouter.get('/:id/activity', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const activities = await prisma.activityLog.findMany({
      where: { leadId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, role: true } },
      },
    });
    res.json({ activities });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
