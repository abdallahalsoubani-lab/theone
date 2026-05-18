import { describe, expect, it } from 'vitest';

import {
  expandRecurrence,
  MAX_SERIES_OCCURRENCES,
  shiftByOneDay,
  shiftByOneWeek,
} from '../recurrence';

// Use 2026-05-17 = Sunday (anchor for Asia/Amman clinical workweek).
const SUNDAY_10AM = new Date(Date.UTC(2026, 4, 17, 10, 0, 0));

describe('expandRecurrence', () => {
  it('honors the first start time exactly even when its weekday is not in byWeekday', () => {
    const out = expandRecurrence(
      { frequency: 'WEEKLY', interval: 1, byWeekday: ['MON'], count: 3 },
      SUNDAY_10AM,
      45,
    );
    expect(out).toHaveLength(3);
    expect(out[0]!.startsAt.toISOString()).toBe(SUNDAY_10AM.toISOString());
    // Subsequent slots fall on Mondays at the same time of day.
    expect(out[1]!.startsAt.getUTCDay()).toBe(1);
    expect(out[2]!.startsAt.getUTCDay()).toBe(1);
  });

  it('generates the requested count across multiple weekdays', () => {
    const out = expandRecurrence(
      { frequency: 'WEEKLY', interval: 1, byWeekday: ['SUN', 'TUE', 'THU'], count: 6 },
      SUNDAY_10AM,
      30,
    );
    expect(out).toHaveLength(6);
    // First three should be Sun/Tue/Thu of the same week.
    expect(out[0]!.startsAt.getUTCDay()).toBe(0);
    expect(out[1]!.startsAt.getUTCDay()).toBe(2);
    expect(out[2]!.startsAt.getUTCDay()).toBe(4);
    // Next three in the following week.
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    expect(out[3]!.startsAt.getTime() - out[0]!.startsAt.getTime()).toBe(oneWeekMs);
    expect(out[4]!.startsAt.getTime() - out[1]!.startsAt.getTime()).toBe(oneWeekMs);
    expect(out[5]!.startsAt.getTime() - out[2]!.startsAt.getTime()).toBe(oneWeekMs);
  });

  it('respects the interval (every-2-weeks skips a week)', () => {
    const out = expandRecurrence(
      { frequency: 'WEEKLY', interval: 2, byWeekday: ['SUN'], count: 3 },
      SUNDAY_10AM,
      30,
    );
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    expect(out[1]!.startsAt.getTime() - out[0]!.startsAt.getTime()).toBe(twoWeeksMs);
    expect(out[2]!.startsAt.getTime() - out[1]!.startsAt.getTime()).toBe(twoWeeksMs);
  });

  it('assigns dense 0..N-1 indices in chronological order', () => {
    const out = expandRecurrence(
      { frequency: 'WEEKLY', interval: 1, byWeekday: ['SUN', 'WED'], count: 4 },
      SUNDAY_10AM,
      30,
    );
    expect(out.map((o) => o.index)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.startsAt.getTime()).toBeGreaterThan(out[i - 1]!.startsAt.getTime());
    }
  });

  it('refuses to expand past MAX_SERIES_OCCURRENCES', () => {
    expect(() =>
      expandRecurrence(
        { frequency: 'WEEKLY', interval: 1, byWeekday: ['SUN'], count: MAX_SERIES_OCCURRENCES + 1 },
        SUNDAY_10AM,
        30,
      ),
    ).toThrow();
  });

  it('rejects rules with no weekdays selected', () => {
    expect(() =>
      expandRecurrence(
        { frequency: 'WEEKLY', interval: 1, byWeekday: [], count: 3 },
        SUNDAY_10AM,
        30,
      ),
    ).toThrow();
  });

  it('returns an empty list when count is 0', () => {
    expect(
      expandRecurrence(
        { frequency: 'WEEKLY', interval: 1, byWeekday: ['SUN'], count: 0 },
        SUNDAY_10AM,
        30,
      ),
    ).toEqual([]);
  });
});

describe('shift helpers', () => {
  it('shiftByOneDay advances startsAt by exactly 24h, preserving index + duration', () => {
    const occ = { index: 7, startsAt: SUNDAY_10AM, durationMinutes: 45 };
    const out = shiftByOneDay(occ);
    expect(out.index).toBe(7);
    expect(out.durationMinutes).toBe(45);
    expect(out.startsAt.getTime() - SUNDAY_10AM.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('shiftByOneWeek advances startsAt by exactly 7 days', () => {
    const occ = { index: 0, startsAt: SUNDAY_10AM, durationMinutes: 30 };
    const out = shiftByOneWeek(occ);
    expect(out.startsAt.getTime() - SUNDAY_10AM.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
