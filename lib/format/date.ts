import { LATIN_NUMBERING, resolveIntlLocale, type AppLocale } from './locale';

/**
 * Hijri support: pass `calendar: 'islamic-umalqura'` to render the Umm al-Qura
 * Islamic calendar (the civil calendar of Saudi Arabia, the most widely-used
 * Hijri variant for software). The underlying ISO timestamp never changes —
 * only the formatted output. Wiring the user-level preference into the UI is
 * owned by Prompt 5 (profile settings); the parameter exists here so feature
 * code can opt in once the preference is read.
 */
export type CalendarSystem = 'gregory' | 'islamic-umalqura';

interface CalendarOption {
  calendar?: CalendarSystem;
}

function baseOptions(calendar?: CalendarSystem): Intl.DateTimeFormatOptions {
  return calendar ? { ...LATIN_NUMBERING, calendar } : { ...LATIN_NUMBERING };
}

/** Long, human-friendly date — "June 1, 2026" / "1 يونيو 2026". */
export function formatDate(date: Date, locale: AppLocale, opts: CalendarOption = {}): string {
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
    ...baseOptions(opts.calendar),
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** Short numeric date — "06/01/2026" (en-US) / "1‏/6‏/2026" (ar-JO). */
export function formatShortDate(date: Date, locale: AppLocale, opts: CalendarOption = {}): string {
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
    ...baseOptions(opts.calendar),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** 12-hour clock time with AM/PM — "2:30 PM" / "2:30 م". */
export function formatTime(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
    ...LATIN_NUMBERING,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** Combined long date + time. */
export function formatDateTime(date: Date, locale: AppLocale, opts: CalendarOption = {}): string {
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
    ...baseOptions(opts.calendar),
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

const RELATIVE_THRESHOLDS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'second', ms: 1000 },
];

/** Relative time — "in 3 hours" / "منذ ساعتين". `now` defaults to current time. */
export function formatRelative(date: Date, locale: AppLocale, now: Date = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat(resolveIntlLocale(locale), {
    numeric: 'auto',
    style: 'long',
  });
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  for (const { unit, ms } of RELATIVE_THRESHOLDS) {
    if (abs >= ms || unit === 'second') {
      const value = Math.round(diff / ms);
      return rtf.format(value, unit);
    }
  }
  return rtf.format(0, 'second');
}
