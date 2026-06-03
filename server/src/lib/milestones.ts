import { prisma } from './prisma.js';

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export async function recalculateMilestones(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { meetings: { where: { status: 'COMPLETED' }, orderBy: { scheduledAt: 'asc' } } },
  });
  if (!lead) return;

  const dqlMeeting = lead.meetings.find((m) => m.type === 'DQL');
  const ppMeeting = lead.meetings.find((m) => m.type === 'PP');

  const daysLeadToDQL = dqlMeeting
    ? daysBetween(lead.createdAt, dqlMeeting.scheduledAt)
    : null;

  const daysDQLToPP =
    dqlMeeting && ppMeeting
      ? daysBetween(dqlMeeting.scheduledAt, ppMeeting.scheduledAt)
      : null;

  let daysPPToOnboarding: number | null = null;
  if (ppMeeting && lead.stage === 'ONBOARDING') {
    daysPPToOnboarding = daysBetween(ppMeeting.scheduledAt, lead.updatedAt);
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      daysLeadToDQL: daysLeadToDQL ?? undefined,
      daysDQLToPP: daysDQLToPP ?? undefined,
      daysPPToOnboarding: daysPPToOnboarding ?? undefined,
    },
  });
}
