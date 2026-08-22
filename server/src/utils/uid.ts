export function normalizeUid(rawUid: unknown): string {
  if (typeof rawUid !== 'string') return '';
  return rawUid.trim().toUpperCase().replace(/[\s:-]/g, '');
}
