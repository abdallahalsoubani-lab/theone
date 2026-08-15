/**
 * Patient display name — ENGLISH ONLY (Prompt 47 row 8, closing the QA
 * sheet): the clinic removed the Arabic-name field from registration and
 * the patient file; the English name is THE name everywhere (calendar,
 * arrivals, lobby, kiosk, lists, PDFs, WhatsApp variables).
 *
 * One deliberate, data-driven exception to "English, full stop": at the
 * time of this change 258 of the 265 production patients (P50 rule +
 * the P52 import) have NO English name at all — an Arabic-only record.
 * For those the stored Arabic name is returned as a LAST-RESORT fallback,
 * because a blank label on the calendar/kiosk/WhatsApp would be worse
 * than any name. There is no locale preference anymore: English wins
 * whenever it exists, in both UIs.
 *
 * The signature keeps taking both names (and a locale, now unused) so a
 * future reversal is one function body — the columns and call sites are
 * untouched.
 */
export function patientDisplayName(
  nameEn: string | null | undefined,
  nameAr: string | null | undefined,
  _locale?: string,
): string {
  const en = nameEn?.trim() ?? '';
  const ar = nameAr?.trim() ?? '';
  return en || ar;
}
