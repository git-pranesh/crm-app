/**
 * Shared validation for the "select category, then attach a file" pattern
 * used by both call attachments and meeting MOM attachments. Each selected
 * category must be paired with exactly one uploaded file (a non-empty
 * `storagePath` or `fileUrl`) — without this check the client can submit
 * more category selections than files actually uploaded, producing
 * attachment records with neither field set that can never resolve to a
 * signed URL, silently losing the "attachment" the user thought they added.
 */
export interface AttachmentEntry {
  type: string;
  storagePath?: string;
  fileUrl?: string;
}

/**
 * Validates that a "selected categories" list (e.g. `momAttachmentTypes`)
 * and an independently-submitted attachments array represent the exact same
 * multiset of categories — same count, same types. Without this check a
 * client (or a direct API call) can select a category with no corresponding
 * attachment, or attach a file under a category never selected, silently
 * breaking the one-file-per-category guarantee `validateAttachmentPairing`
 * otherwise enforces on the attachments array alone.
 */
export function assertAttachmentTypesMatch(
  selectedTypes: string[] | undefined,
  attachments: AttachmentEntry[] | undefined,
  label: string,
): void {
  const selected = [...(selectedTypes ?? [])].sort();
  const attached = [...(attachments ?? [])].map((a) => a.type).sort();
  if (selected.length !== attached.length || selected.some((t, i) => t !== attached[i])) {
    throw new Error(
      `${label}: selected categories must exactly match the attached files, one file per category (selected: ${selected.join(', ') || 'none'}; attached: ${attached.join(', ') || 'none'})`,
    );
  }
}

export function validateAttachmentPairing(
  attachments: AttachmentEntry[] | undefined,
  allowedTypes: readonly string[],
  label: string,
): void {
  if (!attachments?.length) return;

  const seenTypes = new Set<string>();
  attachments.forEach((att, i) => {
    if (!att.type || !allowedTypes.includes(att.type)) {
      throw new Error(`${label} item #${i + 1}: type must be one of ${allowedTypes.join(', ')}`);
    }
    if (!att.storagePath?.trim() && !att.fileUrl?.trim()) {
      throw new Error(`${label} item #${i + 1} (${att.type}): a file must be uploaded before it can be attached — storagePath or fileUrl is required`);
    }
    if (seenTypes.has(att.type)) {
      throw new Error(`${label}: category "${att.type}" is attached more than once — exactly one file is allowed per category`);
    }
    seenTypes.add(att.type);
  });
}
