import { describe, expect, it } from 'vitest';

import {
  clinicDateKey,
  clinicDayRange,
  clinicHm,
  clinicWallParts,
  clinicWallToInstant,
  formatClinicDateTimeLocal,
  fromClinicWall,
  parseClinicDateTimeLocal,
  toClinicWall,
  tzOffsetMs,
} from '../clinic';

/**
 * The suite runs with TZ=UTC (vitest.config.ts) — prod-VM parity. Every
 * assertion here proves clinic-wall math is independent of the process zone;
 * an accidental `getHours()`/bare-parse regression flips these immediately.
 */

const TZ = 'Asia/Amman'; // fixed UTC+3 since Jordan abolished DST (2022)

describe('tzOffsetMs', () => {
  it('is +3h for Asia/Amman (summer and winter — Jordan is fixed-offset)', () => {
    expect(tzOffsetMs(new Date('2026-07-23T12:00:00Z'), TZ)).toBe(3 * 3_600_000);
    expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), TZ)).toBe(3 * 3_600_000);
  });

  it('handles a DST-observing zone at both offsets', () => {
    expect(tzOffsetMs(new Date('2026-07-01T12:00:00Z'), 'Europe/Berlin')).toBe(2 * 3_600_000);
    expect(tzOffsetMs(new Date('2026-01-01T12:00:00Z'), 'Europe/Berlin')).toBe(1 * 3_600_000);
  });
});

describe('clinicWallParts / clinicDateKey / clinicHm', () => {
  it('reads 12:30Z as 15:30 Amman wall clock', () => {
    const instant = new Date('2026-07-23T12:30:00Z');
    expect(clinicWallParts(instant, TZ)).toMatchObject({
      year: 2026,
      month: 7,
      day: 23,
      hour: 15,
      minute: 30,
    });
    expect(clinicDateKey(instant, TZ)).toBe('2026-07-23');
    expect(clinicHm(instant, TZ)).toBe('15:30');
  });

  it('rolls the calendar day across clinic midnight (22:30Z = 01:30 next day Amman)', () => {
    const instant = new Date('2026-07-22T22:30:00Z');
    expect(clinicDateKey(instant, TZ)).toBe('2026-07-23');
    expect(clinicHm(instant, TZ)).toBe('01:30');
  });
});

describe('clinicWallToInstant', () => {
  it('maps Amman wall 15:30 back to 12:30Z', () => {
    expect(
      clinicWallToInstant(
        { year: 2026, month: 7, day: 23, hour: 15, minute: 30 },
        TZ,
      ).toISOString(),
    ).toBe('2026-07-23T12:30:00.000Z');
  });

  it('round-trips through clinicWallParts', () => {
    const instant = new Date('2026-03-11T06:45:00Z');
    const p = clinicWallParts(instant, TZ);
    expect(clinicWallToInstant(p, TZ).toISOString()).toBe(instant.toISOString());
  });
});

describe('datetime-local parsing / formatting (booking round-trip — §5)', () => {
  it('clinic-local "2026-07-23T15:30" → 12:30Z → formats back as 15:30', () => {
    const instant = parseClinicDateTimeLocal('2026-07-23T15:30', TZ);
    expect(instant?.toISOString()).toBe('2026-07-23T12:30:00.000Z');
    expect(formatClinicDateTimeLocal(instant!, TZ)).toBe('2026-07-23T15:30');
  });

  it('accepts an optional seconds part and rejects malformed input', () => {
    expect(parseClinicDateTimeLocal('2026-07-23T15:30:00', TZ)?.toISOString()).toBe(
      '2026-07-23T12:30:00.000Z',
    );
    expect(parseClinicDateTimeLocal('not-a-date', TZ)).toBeNull();
    expect(parseClinicDateTimeLocal('', TZ)).toBeNull();
  });
});

describe('clinicDayRange', () => {
  it('bounds the clinic-local day in UTC instants', () => {
    const { start, end } = clinicDayRange(new Date('2026-07-23T12:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-07-22T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-23T21:00:00.000Z');
  });

  it('an instant just after clinic midnight belongs to the NEW clinic day', () => {
    // 22:30Z = 01:30 Amman on the 24th.
    const { start, end } = clinicDayRange(new Date('2026-07-23T22:30:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-07-23T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-24T21:00:00.000Z');
    // A 23:30-Amman appointment is still inside "today" (kiosk matching — §5).
    const lateAppt = new Date('2026-07-24T20:30:00.000Z'); // 23:30 Amman on the 24th
    expect(lateAppt.getTime() >= start.getTime() && lateAppt.getTime() < end.getTime()).toBe(true);
  });
});

describe('toClinicWall / fromClinicWall (calendar grid mapping — P-8)', () => {
  it('under a UTC process, the wall Date reads clinic time via LOCAL getters', () => {
    const wall = toClinicWall(new Date('2026-07-23T12:30:00Z'), TZ);
    // TZ=UTC in tests → local getters ARE UTC getters; the +3h shift is visible.
    expect(wall.getHours()).toBe(15);
    expect(wall.getMinutes()).toBe(30);
    expect(wall.getDate()).toBe(23);
  });

  it('fromClinicWall inverts toClinicWall exactly', () => {
    for (const iso of [
      '2026-07-23T12:30:00.000Z',
      '2026-07-22T21:00:00.000Z', // clinic midnight
      '2026-12-31T22:15:00.000Z', // year rollover in clinic time
    ]) {
      const instant = new Date(iso);
      expect(fromClinicWall(toClinicWall(instant, TZ), TZ).toISOString()).toBe(iso);
    }
  });

  it('a grid-built wall Date (clinic 10:00) converts to the right instant', () => {
    // Simulates rbc handing back a slot the user dropped at 10:00 on the grid.
    const gridDate = new Date(2026, 6, 23, 10, 0, 0, 0); // local = UTC in tests
    expect(fromClinicWall(gridDate, TZ).toISOString()).toBe('2026-07-23T07:00:00.000Z');
  });
});
