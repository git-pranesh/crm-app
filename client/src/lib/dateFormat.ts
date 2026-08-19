/**
 * Shared IST (India Standard Time) formatting helpers — task #112.
 *
 * Timestamps are always stored in UTC in the database; this app is India-only
 * per current scope, so every display surface must render in Asia/Kolkata
 * rather than relying on the browser's local timezone (which is UTC in most
 * server/CI/sandbox environments and silently makes every timestamp look
 * 5.5 hours off). Any new timestamp display should use one of these helpers
 * instead of calling toLocaleString/toLocaleDateString/toLocaleTimeString
 * directly.
 */

export const IST_TZ = 'Asia/Kolkata';

/** e.g. "2:45 PM" */
export function formatISTTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: IST_TZ,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** e.g. "12 Aug" — pass opts to add/override fields (e.g. { year: 'numeric' }). */
export function formatISTDate(iso: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: IST_TZ,
    day: 'numeric',
    month: 'short',
    ...opts,
  });
}

/** Standard possession display. Legacy text values remain readable unchanged. */
export function formatPossession(value?: string | null): string {
  if (!value) return '—';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return formatISTDate(`${value}T00:00:00+05:30`, { year: 'numeric' });
}

/** e.g. "12 Aug, 2:45 PM" */
export function formatISTDateTime(iso: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: IST_TZ,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    ...opts,
  });
}

/** "YYYY-MM-DD" for the current moment in IST — for date-input min/default values. */
export function todayISTDateString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Calendar-day label ("Today" / "Yesterday" / date) computed in IST, not browser-local time. */
export function istDateGroupLabel(iso: string): string {
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: IST_TZ }).format(d);
  const target = dayKey(new Date(iso));
  const now = new Date();
  if (target === dayKey(now)) return 'Today';
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (target === dayKey(yesterday)) return 'Yesterday';
  return formatISTDate(iso, { year: 'numeric' });
}
