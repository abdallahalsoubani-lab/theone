/**
 * Locale resolution + shared options for the format helpers.
 *
 * Both locales use Latin digits per Prompt 3 §3 (Arabic-Indic numerals like
 * ١٢٣ are explicitly out of scope; standard practice in Jordan is Western
 * digits even in Arabic prose). The `numberingSystem: 'latn'` option on
 * Intl.{DateTimeFormat,NumberFormat} pins this — without it, `ar-JO` would
 * default to Arabic-Indic digits.
 */

export type AppLocale = 'en' | 'ar';

/**
 * Display-layer clinic timezone. All DateTime storage is UTC; the format
 * helpers pin rendering to this zone so server-rendered timestamps show
 * clinic wall-clock time regardless of the host machine's TZ. The
 * server-side override source is `ClinicSettings.timezone` (pinned
 * read-only in the admin UI).
 */
export const CLINIC_TIME_ZONE = 'Asia/Amman';

export function resolveIntlLocale(locale: AppLocale): string {
  return locale === 'ar' ? 'ar-JO' : 'en-US';
}

export const LATIN_NUMBERING: { numberingSystem: 'latn' } = {
  numberingSystem: 'latn',
};
