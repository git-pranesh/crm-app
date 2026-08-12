// Single source of truth for role-based lead scoping. Used by both the
// leads list endpoint and the dashboard so their populations can never
// drift apart (task #113 review: dashboard/list scope mismatches broke
// KPI drill-through exactness for BL users).
export interface ScopeUser {
  id: string;
  role: string;
}

export async function buildLeadRoleWhere(
  user: ScopeUser,
  prisma: { user: { findMany: (args: any) => Promise<{ id: string }[]> } },
): Promise<any> {
  if (user.role === 'DESIGNER') {
    return { assignedDesignerId: user.id };
  }
  if (user.role === 'CRE') {
    return { OR: [{ assignedDesignerId: user.id }, { createdById: user.id }] };
  }
  if (user.role === 'BL') {
    const members = await prisma.user.findMany({
      where: { blId: user.id, isActive: true },
      select: { id: true },
    });
    // A BL sees leads assigned to their team OR directly assigned to them.
    return {
      OR: [
        { assignedDesignerId: { in: [user.id, ...members.map((m) => m.id)] } },
        { assignedBLId: user.id },
      ],
    };
  }
  // BRANCH_HEAD / ADMIN — no filter.
  return {};
}
