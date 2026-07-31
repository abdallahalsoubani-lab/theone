import { patientDisplayName } from '@/lib/format/patientName';

/**
 * Fix 45.1 — the kiosk's two name slots, computed ONE way for every row and
 * for the confirm screen:
 *
 *   primary — always filled: the active locale's name, falling back to the
 *             other script when it's missing (the patientDisplayName rule).
 *             Always rendered in the same size/weight (500).
 *   alt     — the OTHER script, only when it exists and differs from what
 *             the primary slot ended up showing. Rendered smaller at 400.
 *
 * This kills the broken state where an English-only patient in /ar rendered
 * with an empty primary line and their name in the secondary style.
 */
export function kioskNamePair(
  names: { fullNameEn: string; fullNameAr: string },
  locale: string,
): { primary: string; alt: string | null } {
  const primary = patientDisplayName(names.fullNameEn, names.fullNameAr, locale);
  const other = (locale === 'ar' ? names.fullNameEn : names.fullNameAr).trim();
  return { primary, alt: other && other !== primary ? other : null };
}
