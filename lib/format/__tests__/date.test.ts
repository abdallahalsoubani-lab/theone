import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatRelative, formatShortDate, formatTime } from '../date';

const REFERENCE = new Date('2026-06-01T14:30:00Z');

describe('formatDate', () => {
  it('renders long English form with Latin digits', () => {
    const out = formatDate(REFERENCE, 'en');
    expect(out).toMatch(/June/);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/1/);
  });

  it('renders long Arabic form with Latin digits (Arabic-Indic explicitly out of scope)', () => {
    const out = formatDate(REFERENCE, 'ar');
    expect(out).toMatch(/2026/);
    // ar-JO uses Levantine month names: "حزيران" (June). Other June names
    // ("يونيو", "يونية") are Egyptian/Gulf — wrong for Jordan.
    expect(out).toMatch(/حزيران|يونيو/);
    // No Arabic-Indic digits — must stay Latin per Prompt 3 §3
    expect(out).not.toMatch(/[٠-٩]/);
  });

  it('accepts a Hijri calendar without changing the underlying timestamp', () => {
    const gregorian = formatDate(REFERENCE, 'ar', { calendar: 'gregory' });
    const hijri = formatDate(REFERENCE, 'ar', { calendar: 'islamic-umalqura' });
    expect(hijri).not.toBe(gregorian);
    // Hijri year should appear (1447 or 1448 depending on exact moment)
    expect(hijri).toMatch(/144[78]/);
  });
});

describe('formatShortDate / formatTime / formatDateTime', () => {
  it('formatShortDate is numeric in both locales', () => {
    expect(formatShortDate(REFERENCE, 'en')).toMatch(/06\/01\/2026|6\/1\/2026/);
    expect(formatShortDate(REFERENCE, 'ar')).toMatch(/2026/);
  });

  it('formatTime renders 12-hour with AM/PM marker', () => {
    expect(formatTime(REFERENCE, 'en')).toMatch(/PM/i);
    expect(formatTime(REFERENCE, 'ar')).toMatch(/م|PM/);
  });

  it('formatDateTime concatenates date and time', () => {
    const en = formatDateTime(REFERENCE, 'en');
    expect(en).toMatch(/June/);
    expect(en).toMatch(/PM/i);
  });
});

describe('clinic timezone pinning (QA 2.2)', () => {
  // Newer ICU builds separate the dayPeriod with U+202F / U+00A0 — normalise
  // so the assertions stay exact on the digits without pinning the space kind.
  const norm = (s: string) => s.replace(/[  ]/g, ' ');

  it('renders a UTC instant as Amman wall-clock regardless of host TZ', () => {
    // 07:00 UTC = 10:00 Asia/Amman (UTC+3).
    expect(norm(formatTime(new Date('2026-07-13T07:00:00Z'), 'en'))).toBe('10:00 AM');
  });

  it('renders Arabic afternoon time in clinic wall-clock', () => {
    // 11:56 UTC = 14:56 Amman → "2:56 م" on a 12-hour clock.
    const out = norm(formatDateTime(new Date('2026-07-13T11:56:00Z'), 'ar'));
    expect(out).toContain('2:56');
    expect(out).toContain('م');
  });

  it('rolls the calendar day over at clinic midnight, not UTC midnight', () => {
    // 21:30 UTC July 13 = 00:30 Amman July 14.
    const out = norm(formatDateTime(new Date('2026-07-13T21:30:00Z'), 'en'));
    expect(out).toContain('July 14');
    expect(out).toContain('12:30 AM');
  });

  it('round-trips a 10:00 Amman booking stored as 07:00 UTC in both locales', () => {
    const stored = new Date('2026-07-14T07:00:00Z');
    expect(norm(formatTime(stored, 'en'))).toBe('10:00 AM');
    // Latin digits per LATIN_NUMBERING, Arabic dayPeriod marker.
    expect(norm(formatTime(stored, 'ar'))).toBe('10:00 ص');
  });

  it('honours an explicit timeZone override', () => {
    expect(norm(formatTime(new Date('2026-07-13T07:00:00Z'), 'en', { timeZone: 'UTC' }))).toBe(
      '7:00 AM',
    );
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('renders "in N hours" for a future date in English', () => {
    const future = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    expect(formatRelative(future, 'en', now)).toMatch(/in 3 hours/i);
  });

  it('renders a past relative phrase in Arabic', () => {
    const past = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const out = formatRelative(past, 'ar', now);
    // Either "قبل ..." (before) or "منذ ..." (ago) depending on ICU data version.
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toMatch(/[٠-٩]/);
  });
});
