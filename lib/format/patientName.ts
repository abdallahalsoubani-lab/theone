/**
 * Patient display name with an Arabic→English fallback (July change request
 * #10). The Arabic name is optional: when it is empty and the UI is in Arabic,
 * fall back to the English name so a patient never renders as a blank label on
 * the calendar, arrivals board, lobby display, lists, or detail views.
 *
 * English is always required, so it is a safe fallback. In the English UI we
 * always show the English name.
 */
export function patientDisplayName(
  nameEn: string,
  nameAr: string | null | undefined,
  locale: string,
): string {
  if (locale === 'ar') return nameAr?.trim() || nameEn;
  return nameEn;
}
