import { describe, expect, it } from 'vitest';

import {
  computeReminderFireAt,
  parseHhMm,
  pickSeriesReminderTargets,
  type ReminderConfig,
} from '../reminderWindow';

/**
 * Prompt 17 — reminder fire-time math. Asia/Amman is a fixed UTC+3 (no DST
 * since 2022), so Amman HH:00 = UTC (HH−3):00. Assertions use the resulting
 * UTC ISO string.
 */
const CONFIG: ReminderConfig = {
  offsetMinutes: 1440, // 24h
  windowStartMinutes: parseHhMm('08:00'), // 480
  windowEndMinutes: parseHhMm('18:00'), // 1080
  timeZone: 'Asia/Amman',
};

const D = (iso: string) => new Date(iso);
const fire = (startsAt: string, now: string, config: ReminderConfig = CONFIG) =>
  computeReminderFireAt({ startsAt: D(startsAt), now: D(now), config });

describe('parseHhMm', () => {
  it('parses HH:MM into minutes past midnight', () => {
    expect(parseHhMm('08:00')).toBe(480);
    expect(parseHhMm('18:30')).toBe(1110);
    expect(parseHhMm('00:00')).toBe(0);
  });
});

describe('window math — base inside / shifted to nearest edge', () => {
  const NOW = '2026-07-01T00:00:00Z'; // well before any reminder

  it('10:00 appointment → reminder previous day 10:00 (inside, no shift)', () => {
    // Amman 10:00 = 07:00Z. Base = prev day 10:00 Amman = 2026-07-01T07:00Z.
    expect(fire('2026-07-02T07:00:00Z', NOW)?.toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });

  it('20:00 appointment → 18:00 previous day (after window → clamp down)', () => {
    // Amman 20:00 = 17:00Z. Base = prev day 20:00 Amman → clamp to 18:00 Amman = 15:00Z.
    expect(fire('2026-07-02T17:00:00Z', NOW)?.toISOString()).toBe('2026-07-01T15:00:00.000Z');
  });

  it('07:00 appointment → 08:00 previous day (before window → clamp up)', () => {
    // Amman 07:00 = 04:00Z. Base = prev day 07:00 → clamp to 08:00 Amman = 05:00Z.
    expect(fire('2026-07-02T04:00:00Z', NOW)?.toISOString()).toBe('2026-07-01T05:00:00.000Z');
  });

  it('18:00 appointment → base exactly 18:00 counts as inside (no shift)', () => {
    // Amman 18:00 = 15:00Z. Base = prev day 18:00 Amman = 2026-07-01T15:00Z, exactly the edge.
    expect(fire('2026-07-02T15:00:00Z', NOW)?.toISOString()).toBe('2026-07-01T15:00:00.000Z');
  });

  it('08:00 appointment → base exactly 08:00 counts as inside (no shift)', () => {
    // Amman 08:00 = 05:00Z. Base = prev day 08:00 Amman = 2026-07-01T05:00Z.
    expect(fire('2026-07-02T05:00:00Z', NOW)?.toISOString()).toBe('2026-07-01T05:00:00.000Z');
  });
});

describe('late bookings (created < 24h before start)', () => {
  it('inside the window now → send immediately', () => {
    // now Amman 14:00 = 11:00Z; appointment Amman 16:00 same day = 13:00Z (2h ahead).
    const now = '2026-07-01T11:00:00Z';
    expect(fire('2026-07-01T13:00:00Z', now)?.toISOString()).toBe('2026-07-01T11:00:00.000Z');
  });

  it('outside the window now → next window opening', () => {
    // now Amman 22:00 = 19:00Z; appointment tomorrow Amman 14:00 = 2026-07-02T11:00Z.
    // Next opening = tomorrow 08:00 Amman = 2026-07-02T05:00Z (before the appointment).
    const now = '2026-07-01T19:00:00Z';
    expect(fire('2026-07-02T11:00:00Z', now)?.toISOString()).toBe('2026-07-02T05:00:00.000Z');
  });

  it('cannot fit before the appointment starts → skip (null)', () => {
    // now Amman 22:00 = 19:00Z; appointment tomorrow Amman 07:00 = 2026-07-02T04:00Z.
    // Next opening tomorrow 08:00 Amman = 05:00Z is AFTER the 07:00 appointment → skip.
    const now = '2026-07-01T19:00:00Z';
    expect(fire('2026-07-02T04:00:00Z', now)).toBeNull();
  });
});

describe('settings-driven window', () => {
  it('a narrower window (09:00–17:00) shifts a 20:00 appointment to 17:00', () => {
    const config: ReminderConfig = {
      ...CONFIG,
      windowStartMinutes: parseHhMm('09:00'),
      windowEndMinutes: parseHhMm('17:00'),
    };
    // Amman 20:00 = 17:00Z. Base prev day 20:00 → clamp to 17:00 Amman = 14:00Z.
    expect(fire('2026-07-02T17:00:00Z', '2026-07-01T00:00:00Z', config)?.toISOString()).toBe(
      '2026-07-01T14:00:00.000Z',
    );
  });

  it('a 12h offset moves the base to the same morning', () => {
    const config: ReminderConfig = { ...CONFIG, offsetMinutes: 720 };
    // Appointment Amman 16:00 = 13:00Z; base = −12h = Amman 04:00 → clamp to 08:00 Amman = 05:00Z.
    expect(fire('2026-07-02T13:00:00Z', '2026-07-01T00:00:00Z', config)?.toISOString()).toBe(
      '2026-07-02T05:00:00.000Z',
    );
  });
});

// ─── P50 (series 45+) §3.2 — same-day dedup (pure) ─────────────────────────

describe('pickSeriesReminderTargets — one reminder per clinic-local day', () => {
  const TZ = 'Asia/Amman';
  const occ = (id: string, iso: string) => ({ id, startsAt: D(iso) });

  it('a single occurrence → itself', () => {
    const only = occ('a', '2030-03-10T07:00:00Z');
    expect(pickSeriesReminderTargets([only], TZ)).toEqual([only]);
  });

  it('three same-day occurrences → the EARLIEST only (input order irrelevant)', () => {
    const a = occ('a', '2030-03-10T11:00:00Z'); // 14:00 Amman
    const b = occ('b', '2030-03-10T06:00:00Z'); // 09:00 Amman ← earliest
    const c = occ('c', '2030-03-10T08:00:00Z'); // 11:00 Amman
    expect(pickSeriesReminderTargets([a, b, c], TZ).map((t) => t.id)).toEqual(['b']);
  });

  it('two same-day + one next day → earliest of day 1 + the day-2 one', () => {
    const d1a = occ('d1a', '2030-03-10T06:00:00Z');
    const d1b = occ('d1b', '2030-03-10T07:00:00Z');
    const d2 = occ('d2', '2030-03-11T06:00:00Z');
    expect(pickSeriesReminderTargets([d2, d1b, d1a], TZ).map((t) => t.id)).toEqual(['d1a', 'd2']);
  });

  it('a multi-day series → one target per day, every day covered (item 4)', () => {
    const rows = [
      occ('m', '2030-03-10T06:00:00Z'),
      occ('w', '2030-03-12T06:00:00Z'),
      occ('f', '2030-03-14T06:00:00Z'),
    ];
    expect(pickSeriesReminderTargets(rows, TZ).map((t) => t.id)).toEqual(['m', 'w', 'f']);
  });

  it('"same day" is the CLINIC day, not UTC — 23:30Z and 00:30Z next UTC day are both one Amman day', () => {
    // 2030-03-10T23:30Z = 11 Mar 02:30 Amman; 2030-03-11T00:30Z = 11 Mar 03:30 Amman.
    const late = occ('late', '2030-03-10T23:30:00Z');
    const early = occ('early', '2030-03-11T00:30:00Z');
    expect(pickSeriesReminderTargets([early, late], TZ).map((t) => t.id)).toEqual(['late']);
    // …whereas 20:30Z (23:30 Amman, 10 Mar) and 23:30Z (02:30 Amman, 11 Mar) are two days.
    const prev = occ('prev', '2030-03-10T20:30:00Z');
    expect(pickSeriesReminderTargets([late, prev], TZ).map((t) => t.id)).toEqual(['prev', 'late']);
  });

  it('cancelled sibling → the next one inherits (the caller feeds only live rows)', () => {
    const first = occ('first', '2030-03-10T06:00:00Z');
    const second = occ('second', '2030-03-10T07:00:00Z');
    expect(pickSeriesReminderTargets([first, second], TZ).map((t) => t.id)).toEqual(['first']);
    // After `first` is cancelled it is no longer a live occurrence:
    expect(pickSeriesReminderTargets([second], TZ).map((t) => t.id)).toEqual(['second']);
  });

  it('does not mutate its input', () => {
    const rows = [occ('b', '2030-03-10T07:00:00Z'), occ('a', '2030-03-10T06:00:00Z')];
    pickSeriesReminderTargets(rows, TZ);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('empty input → no targets', () => {
    expect(pickSeriesReminderTargets([], TZ)).toEqual([]);
  });
});
