import type { Lead } from '@prisma/client';

/**
 * PLACEHOLDER scoring — founder has not defined real criteria yet.
 * Wire the mechanism now; swap the formula later without touching
 * the audit/override plumbing.
 *
 * Input: a Lead record enriched with calls[] and meetings[].
 */
export function computeSystemRating(
  lead: Lead & { calls?: { id: string }[]; meetings?: { status: string; id: string }[] },
): number {
  let score = 1;
  if (lead.estimatedValue && Number(lead.estimatedValue) > 0) score++;
  if (lead.possessionTimeline) score++;
  if (lead.calls && lead.calls.length > 0) score++;
  if (lead.meetings && lead.meetings.some((m) => m.status === 'SCHEDULED')) score++;
  return Math.min(score, 5);
}
