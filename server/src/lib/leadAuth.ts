import { prisma } from './prisma.js';

/**
 * Returns true if the authenticated user is permitted to access or mutate the
 * given lead.  Call this after finding the lead but before doing any DB writes.
 *
 * Scope rules (mirror the GET /api/leads list filter):
 *  - ADMIN / BRANCH_HEAD : any lead
 *  - DESIGNER / CRE      : only leads where assignedDesignerId === user.id
 *  - BL                  : leads where assignedBLId === user.id, OR where
 *                          assignedDesignerId belongs to one of their team members
 */
export async function isAuthorizedForLead(
  lead: { assignedDesignerId: string | null; assignedBLId: string | null },
  user: { id: string; role: string },
): Promise<boolean> {
  if (['ADMIN', 'BRANCH_HEAD'].includes(user.role)) return true;

  if (user.role === 'DESIGNER' || user.role === 'CRE') {
    return lead.assignedDesignerId === user.id;
  }

  if (user.role === 'BL') {
    if (lead.assignedBLId === user.id) return true;
    if (lead.assignedDesignerId) {
      const member = await prisma.user.findFirst({
        where: { id: lead.assignedDesignerId, blId: user.id },
      });
      return !!member;
    }
    return false;
  }

  return false;
}
