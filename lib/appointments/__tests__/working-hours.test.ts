import { describe, expect, it } from 'vitest';

import { type WorkingHoursSettings, isWithinWorkingHours, localDayKey } from '../working-hours';

// Clinic hours 09:00–18:00, Asia/Amman (UTC+3), Monday open.
const SETTINGS: WorkingHoursSettings = {
  timeZone: 'Asia/Amman',
  hours: {
    sun: { open: '09:00', close: '18:00', closed: false },
    mon: { open: '09:00', close: '18:00', closed: false },
    tue: { open: '09:00', close: '18:00', closed: false },
    wed: { open: '09:00', close: '18:00', closed: false },
    thu: { open: '09:00', close: '18:00', closed: false },
    fri: { open: '09:00', close: '13:00', closed: true },
    sat: { open: '10:00', close: '14:00', closed: false },
  },
};

const MONDAY = '2026-06-01';

/** Build a UTC instant for the given Amman wall-clock time on MONDAY. */
function amman(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  // Amman is UTC+3 → subtract 3h to get the UTC instant.
  const utcHour = String((h ?? 0) - 3).padStart(2, '0');
  return new Date(`${MONDAY}T${utcHour}:${String(m ?? 0).padStart(2, '0')}:00Z`);
}

function withDuration(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * 60_000);
}

describe('isWithinWorkingHours (09:00–18:00 Asia/Amman)', () => {
  it('09:00 start, 30 min → valid (exact open edge)', () => {
    const start = amman('09:00');
    expect(isWithinWorkingHours(start, withDuration(start, 30), SETTINGS)).toEqual({ ok: true });
  });

  it('08:59 start → invalid (before_open)', () => {
    const start = amman('08:59');
    const r = isWithinWorkingHours(start, withDuration(start, 30), SETTINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('before_open');
  });

  it('17:30 start, 30 min, ends 18:00 → valid (exact close edge inclusive)', () => {
    const start = amman('17:30');
    expect(isWithinWorkingHours(start, withDuration(start, 30), SETTINGS)).toEqual({ ok: true });
  });

  it('17:45 start, 30 min, ends 18:15 → invalid (end_exceeds_close)', () => {
    const start = amman('17:45');
    const r = isWithinWorkingHours(start, withDuration(start, 30), SETTINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('end_exceeds_close');
  });

  it('18:00 start → invalid (clinic closing → after_close)', () => {
    const start = amman('18:00');
    const r = isWithinWorkingHours(start, withDuration(start, 30), SETTINGS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('after_close');
  });

  it('11:15 start, 45 min → valid (the recurring false-positive case)', () => {
    const start = amman('11:15');
    expect(isWithinWorkingHours(start, withDuration(start, 45), SETTINGS)).toEqual({ ok: true });
  });

  it('UTC instant that is 09:00 Amman → valid (regression guard for the tz bug)', () => {
    // 06:00Z is exactly 09:00 in Amman. A naive getUTCHours() check would read
    // "06:00" < "09:00" and wrongly reject — this is the test that catches it.
    const start = new Date(`${MONDAY}T06:00:00Z`);
    expect(isWithinWorkingHours(start, withDuration(start, 30), SETTINGS)).toEqual({ ok: true });
  });

  it('returns ok when hours are unconfigured', () => {
    const start = amman('03:00');
    expect(
      isWithinWorkingHours(start, withDuration(start, 30), { timeZone: 'Asia/Amman', hours: null }),
    ).toEqual({ ok: true });
  });

  it('returns ok on a closed day (closed-day rejection is the engine’s concern)', () => {
    const friday = new Date('2026-06-05T10:00:00Z'); // 13:00 Amman, Friday closed
    expect(isWithinWorkingHours(friday, withDuration(friday, 30), SETTINGS)).toEqual({ ok: true });
  });
});

describe('localDayKey', () => {
  it('resolves the weekday in clinic-local time, not UTC', () => {
    // 22:00Z Monday is 01:00 Amman Tuesday — the local day is tuesday.
    expect(localDayKey(new Date(`${MONDAY}T22:00:00Z`), 'Asia/Amman')).toBe('tue');
    // 06:00Z Monday is 09:00 Amman Monday.
    expect(localDayKey(new Date(`${MONDAY}T06:00:00Z`), 'Asia/Amman')).toBe('mon');
  });
});
