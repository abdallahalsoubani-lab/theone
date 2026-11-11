import { describe, expect, it } from 'vitest';

import { expandRepeatDates } from '../batch-repeat';

// 2026-11-14 is a Saturday.
const SAT = '2026-11-14';

describe('expandRepeatDates (P64 #13)', () => {
  it('same weekday × 4 weeks → the 4 following Saturdays, never the source', () => {
    const r = expandRepeatDates({
      sourceDate: SAT,
      weekdays: ['sat'],
      weeks: 4,
      closedDays: [],
      room: 29,
    });
    expect(r).toEqual({
      dates: ['2026-11-21', '2026-11-28', '2026-12-05', '2026-12-12'],
      truncated: false,
    });
  });

  it('several weekdays per week, in date order', () => {
    const r = expandRepeatDates({
      sourceDate: SAT,
      weekdays: ['sat', 'mon', 'wed'],
      weeks: 2,
      closedDays: [],
      room: 29,
    });
    expect(r.dates).toEqual([
      '2026-11-16',
      '2026-11-18',
      '2026-11-21',
      '2026-11-23',
      '2026-11-25',
      '2026-11-28',
    ]);
  });

  it('skips closed clinic days', () => {
    const r = expandRepeatDates({
      sourceDate: SAT,
      weekdays: ['sat', 'fri'],
      weeks: 1,
      closedDays: ['fri'],
      room: 29,
    });
    expect(r.dates).toEqual(['2026-11-21']);
  });

  it('truncates at the remaining row budget and says so', () => {
    const r = expandRepeatDates({
      sourceDate: SAT,
      weekdays: ['sat'],
      weeks: 10,
      closedDays: [],
      room: 3,
    });
    expect(r.dates).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it('invalid source date or zero weeks → nothing', () => {
    expect(
      expandRepeatDates({ sourceDate: '', weekdays: ['sat'], weeks: 3, closedDays: [], room: 29 })
        .dates,
    ).toEqual([]);
    expect(
      expandRepeatDates({ sourceDate: SAT, weekdays: ['sat'], weeks: 0, closedDays: [], room: 29 })
        .dates,
    ).toEqual([]);
  });

  it('crosses month/year boundaries', () => {
    const r = expandRepeatDates({
      sourceDate: '2026-12-26',
      weekdays: ['sat'],
      weeks: 2,
      closedDays: [],
      room: 29,
    });
    expect(r.dates).toEqual(['2027-01-02', '2027-01-09']);
  });
});
