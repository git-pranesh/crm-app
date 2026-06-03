import { prisma } from './prisma.js';

export async function logActivity(
  userId: string,
  action: string,
  leadId?: string,
  meta?: Record<string, unknown>,
) {
  return prisma.activityLog.create({
    data: { userId, action, leadId, meta },
  });
}
