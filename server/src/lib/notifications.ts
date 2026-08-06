import { prisma } from './prisma.js';

export type NotificationType =
  | 'OVERDUE_TASK'
  | 'RNR_ESCALATION'
  | 'DISCOUNT_REQUEST'
  | 'SLA_BREACH'
  | 'MEETING_NO_SHOW'
  | 'TASK_DUE'
  | 'BL_ASSIGNED'
  | 'DESIGNER_ASSIGNED'
  | 'ONBOARDING_DIP_REQUIRED'
  | 'DQL_QUESTIONNAIRE'
  | 'DIP_CHECKLIST_COMPLETE'
  | 'STAGE_MOVED_BACKWARD'
  | 'INTENT_RATING_CHANGED'
  | 'ON_HOLD_REOPEN'
  | 'NPS_SUBMITTED'
  | 'LEAD_REACTIVATED'
  | 'MEETING_SCHEDULED'
  | 'CALL_LOGGED'
  | 'TASK_SCHEDULED'
  | 'TEAM_MEMBER_REQUESTED'
  | 'TEAM_MEMBER_APPROVED'
  | 'TEAM_MEMBER_REJECTED'
  | 'PD_ASSIGNED'
  | 'DTL_ASSIGNED';

export async function createNotification(
  userId: string,
  type: NotificationType,
  message: string,
  leadId?: string,
) {
  return prisma.notificationLog.create({
    data: { userId, type, message, leadId },
  });
}

/** Notify all BLs and Branch Heads */
export async function notifyManagers(
  type: NotificationType,
  message: string,
  leadId?: string,
) {
  const managers = await prisma.user.findMany({
    where: { role: { in: ['BL', 'BRANCH_HEAD'] }, isActive: true },
    select: { id: true },
  });

  await prisma.notificationLog.createMany({
    data: managers.map((m) => ({ userId: m.id, type, message, leadId })),
  });
}

/** Notify specific user's BL (if they have one) */
export async function notifyUserBL(
  userId: string,
  type: NotificationType,
  message: string,
  leadId?: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { blId: true },
  });
  if (user?.blId) {
    await createNotification(user.blId, type, message, leadId);
  }
}
