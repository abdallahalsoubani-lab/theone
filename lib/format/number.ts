import { LATIN_NUMBERING, resolveIntlLocale, type AppLocale } from './locale';

/**
 * Number formatting. Latin digits in both locales by default per Prompt 3 §3.
 *
 * To switch the Arabic locale to Arabic-Indic digits later (if the clinic asks),
 * change LATIN_NUMBERING to { numberingSystem: 'arab' } in lib/format/locale.ts
 * — every formatter inherits the change in one edit.
 */
export function formatNumber(
  value: number,
  locale: AppLocale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(resolveIntlLocale(locale), {
    ...LATIN_NUMBERING,
    ...options,
  }).format(value);
}
