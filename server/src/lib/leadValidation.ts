// ── Shared lead contact-format validation ──────────────────────────────────────
// Used by every lead ingestion path (authenticated create/update, CSV import,
// Meta/Google webhooks) so phone/email format rules — including rejection of
// obviously-fake placeholder numbers — are enforced consistently everywhere.

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function isValidPhone(phone: string): boolean {
  if (!/^[\d\s+\-().]+$/.test(phone.trim())) return false;
  const digits = phone.replace(/[\s\-().+]/g, '');
  if (!/^\d{7,15}$/.test(digits)) return false;
  return !isObviouslyFakePhone(digits);
}

/** Rejects all-same-digit or strictly sequential ascending/descending numbers (e.g. "1111111", "1234567"). */
function isObviouslyFakePhone(digits: string): boolean {
  if (/^(\d)\1+$/.test(digits)) return true;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < digits.length; i++) {
    const prev = Number(digits[i - 1]);
    const cur = Number(digits[i]);
    if (cur !== (prev + 1) % 10) ascending = false;
    if (cur !== (prev + 9) % 10) descending = false;
  }
  return ascending || descending;
}
