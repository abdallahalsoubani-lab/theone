/**
 * Patient display name with a BIDIRECTIONAL fallback (Prompt 50 — replaces
 * the P25 "English required" rule): a patient carries at least ONE of the
 * two names, either alone is valid. The Arabic UI prefers the Arabic name
 * and falls back to English; the English UI prefers English and falls back
 * to Arabic — a patient never renders as a blank label on the calendar,
 * arrivals board, lobby display, lists, PDFs, or WhatsApp variables.
 */
export function patientDisplayName(
  nameEn: string | null | undefined,
  nameAr: string | null | undefined,
  locale: string,
): string {
  const en = nameEn?.trim() ?? '';
  const ar = nameAr?.trim() ?? '';
  if (locale === 'ar') return ar || en;
  return en || ar;
}
