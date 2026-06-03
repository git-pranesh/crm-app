import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../middleware/auth.js';

export const notificationsRouter = Router();

// ── GET /api/notifications/my ─────────────────────────────────────────────────
notificationsRouter.get('/my', verifyToken, async (req, res) => {
  const user = req.user!;

  const [notifications, unreadCount] = await Promise.all([
    prisma.notificationLog.findMany({
      where: { userId: user.id },
      include: { lead: { select: { id: true, leadId: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.notificationLog.count({
      where: { userId: user.id, isRead: false },
    }),
  ]);

  res.json({ unreadCount, notifications });
});

// ── PATCH /api/notifications/:id/read ────────────────────────────────────────
notificationsRouter.patch('/:id/read', verifyToken, async (req, res) => {
  const { id } = req.params;
  const user = req.user!;

  const notification = await prisma.notificationLog.findFirst({
    where: { id, userId: user.id },
  });
  if (!notification) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }

  const updated = await prisma.notificationLog.update({
    where: { id },
    data: { isRead: true },
  });

  res.json({ notification: updated });
});

// ── PATCH /api/notifications/read-all ────────────────────────────────────────
notificationsRouter.patch('/read-all', verifyToken, async (req, res) => {
  const user = req.user!;

  await prisma.notificationLog.updateMany({
    where: { userId: user.id, isRead: false },
    data: { isRead: true },
  });

  res.json({ message: 'All notifications marked as read' });
});
