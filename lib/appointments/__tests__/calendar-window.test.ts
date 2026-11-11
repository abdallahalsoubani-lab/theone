import { describe, expect, it } from 'vitest';

import {
  anchorInstantForDateKey,
  calendarFetchWindow,
  parseCalendarDateParam,
  parseCalendarViewParam,
} from '../calendar-window';

const TZ = 'Asia/Amman';

describe('calendar-window (P64 #1)', () => {
  it('parses only real YYYY-MM-DD dates', () => {
    expect(parseCalendarDateParam('2026-11-09')).toBe('2026-11-09');
    expect(parseCalendarDateParam('2026-02-30')).toBeNull();
    expect(parseCalendarDateParam('2026-1-9')).toBeNull();
    expect(parseCalendarDateParam('garbage')).toBeNull();
    expect(parseCalendarDateParam(undefined)).toBeNull();
  });

  it('parses only known views', () => {
    expect(parseCalendarViewParam('week')).toBe('week');
    expect(parseCalendarViewParam('year')).toBeNull();
  });

  it('anchors inside the named clinic day', () => {
    const a = anchorInstantForDateKey('2026-11-09');
    expect(a.toISOString()).toBe('2026-11-09T12:00:00.000Z');
  });

  it('fetches around a PAST viewed date, not around today', () => {
    const now = new Date('2026-11-11T09:00:00Z');
    const { from, to } = calendarFetchWindow({ dateKey: '2026-08-03', view: 'week', now }, TZ);
    // 7 clinic days before 3 Aug → 27 Jul 00:00 Amman (UTC+3) = 26 Jul 21:00Z.
    expect(from.toISOString()).toBe('2026-07-26T21:00:00.000Z');
    // 21 days after → end of 24 Aug Amman, minus 1 ms.
    expect(to.toISOString()).toBe('2026-08-24T20:59:59.999Z');
  });

  it('defaults to today and day view', () => {
    const now = new Date('2026-11-11T09:00:00Z');
    const { from } = calendarFetchWindow({ dateKey: null, view: null, now }, TZ);
    expect(from.toISOString()).toBe('2026-11-03T21:00:00.000Z');
  });

  it('month view covers the whole grid either side of the anchor', () => {
    const { from, to } = calendarFetchWindow({ dateKey: '2026-03-15', view: 'month' }, TZ);
    expect(from.getTime()).toBeLessThan(Date.parse('2026-02-23T00:00:00Z'));
    expect(to.getTime()).toBeGreaterThan(Date.parse('2026-04-11T00:00:00Z'));
  });
});
