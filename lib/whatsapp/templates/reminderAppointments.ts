import { groupAdjacentAppointments } from '@/lib/arrivals/grouping';
import { CLINIC_TIME_ZONE, LATIN_NUMBERING, resolveIntlLocale } from '@/lib/format/locale';

/**
 * P53 — the one-message-per-patient-per-day reminder body ({{1}}).
 *
 * Pure + worker-safe (no React / next-intl — the reminder workers run in a
 * BullMQ process, so localized words are inlined per locale exactly like the
 * inline ack/arrival strings elsewhere in the worker layer). Times use
 * Intl.DateTimeFormat in the patient's locale, Asia/Amman, Latin digits.
 *
 * Rendering rules (owner decisions 2–5):
 *   - group with the P27 `groupAdjacentAppointments` (zero-gap runs);
 *   - an adjacent run of ≥2 → ONE range  "من الساعة {s} حتى الساعة {e}";
 *   - a standalone appointment → its start time only (no end);
 *   - one group total → that segment alone (no ordinal);
 *   - two+ groups → each labelled with a localized ordinal, joined.
 *
 * The SINGLE-appointment case is handled by the caller (single_v3 template);
 * this formatter is the {{1}} for the MULTI template (2+ appointments).
 */

export type ReminderLocale = 'ar' | 'en';

export interface ReminderAppointment {
  id: string;
  startsAt: Date;
  durationMinutes: number;
}

interface LocaleWords {
  /** "من الساعة {s} حتى الساعة {e}" — an adjacent run rendered as a range. */
  range: (start: string, end: string) => string;
  /** A standalone appointment's start-only phrase. */
  timeOnly: (start: string) => string;
  /** "الموعد {ordinal}: {value}" — a labelled entry when there are ≥2 groups. */
  entry: (ordinal: string, value: string) => string;
  /** Joins labelled entries. */
  separator: string;
  /** Ordinals 1..N; beyond the list, falls back to the plain number. */
  ordinals: string[];
}

const WORDS: Record<ReminderLocale, LocaleWords> = {
  ar: {
    range: (s, e) => `من الساعة ${s} حتى الساعة ${e}`,
    timeOnly: (s) => `الساعة ${s}`,
    entry: (ordinal, value) => `الموعد ${ordinal}: ${value}`,
    separator: '، ',
    ordinals: ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن'],
  },
  en: {
    range: (s, e) => `from ${s} to ${e}`,
    timeOnly: (s) => `at ${s}`,
    entry: (ordinal, value) => `Appointment ${ordinal}: ${value}`,
    separator: ', ',
    ordinals: ['1', '2', '3', '4', '5', '6', '7', '8'],
  },
};

/** One appointment's start time — Intl, patient locale, Asia/Amman, 12-hour,
 *  Latin digits. The single-appointment template's {{1}} uses this too. */
export function reminderTime(instant: Date, locale: ReminderLocale): string {
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: CLINIC_TIME_ZONE,
    ...LATIN_NUMBERING,
  }).format(instant);
}

function endInstant(a: ReminderAppointment): Date {
  return new Date(a.startsAt.getTime() + a.durationMinutes * 60_000);
}

function ordinalLabel(index: number, locale: ReminderLocale): string {
  return WORDS[locale].ordinals[index] ?? String(index + 1);
}

/**
 * Render the {{1}} body for a patient's same-day appointments (2+). Adjacent
 * runs collapse to a range; spaced appointments become labelled entries.
 */
export function formatReminderAppointments(
  appointments: ReminderAppointment[],
  locale: ReminderLocale,
): string {
  const w = WORDS[locale];
  const groups = groupAdjacentAppointments(appointments);

  const segment = (group: ReminderAppointment[]): string => {
    const start = reminderTime(group[0]!.startsAt, locale);
    if (group.length >= 2) {
      const end = reminderTime(endInstant(group[group.length - 1]!), locale);
      return w.range(start, end);
    }
    return w.timeOnly(start);
  };

  // A single group (all adjacent, or a lone appointment) → the segment alone,
  // no ordinal (decision 2). Two+ groups → each labelled (decisions 3–4).
  if (groups.length === 1) return segment(groups[0]!);
  return groups
    .map((group, i) => w.entry(ordinalLabel(i, locale), segment(group)))
    .join(w.separator);
}

/**
 * P64 #3 — the appointment DAY as words: "يوم السبت 14 نوفمبر" /
 * "on Saturday 14 November". Computed from the APPOINTMENT's own date in
 * clinic time — never "tomorrow": a Thursday booking for Saturday must say
 * Saturday («غداً» was hard-coded in the v3 template bodies).
 */
export function reminderDayPhrase(instant: Date, locale: ReminderLocale): string {
  // 'ar' (not ar-JO) → «نوفمبر», the month names the clinic writes.
  const parts = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: CLINIC_TIME_ZONE,
    ...LATIN_NUMBERING,
  }).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return locale === 'ar'
    ? `يوم ${get('weekday')} ${get('day')} ${get('month')}`
    : `on ${get('weekday')} ${get('day')} ${get('month')}`;
}

/**
 * P64 #3 — "when" for one patient's appointments on ONE clinic day: the day
 * phrase + the time(s). One appointment → "يوم السبت 14 نوفمبر الساعة 10:00 ص";
 * several → the day phrase + the P53 day summary (ranges / labelled entries).
 */
export function appointmentWhenText(
  appointments: ReminderAppointment[],
  locale: ReminderLocale,
): string {
  const sorted = [...appointments].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const first = sorted[0];
  if (!first) return '';
  const day = reminderDayPhrase(first.startsAt, locale);
  const times =
    sorted.length === 1
      ? WORDS[locale].timeOnly(reminderTime(first.startsAt, locale))
      : formatReminderAppointments(sorted, locale);
  return sorted.length === 1 ? `${day} ${times}` : `${day}: ${times}`;
}

/** P64 #3 — the reminder sentence carried inside the custom-message frame. */
export function reminderCustomText(
  appointments: ReminderAppointment[],
  locale: ReminderLocale,
): string {
  const when = appointmentWhenText(appointments, locale);
  if (locale === 'ar') {
    return appointments.length > 1
      ? `نذكّركم بمواعيدكم في المركز ${when}.`
      : `نذكّركم بموعدكم في المركز ${when}.`;
  }
  return appointments.length > 1
    ? `A reminder of your appointments at the center ${when}.`
    : `A reminder of your appointment at the center ${when}.`;
}
