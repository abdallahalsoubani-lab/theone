import { describe, expect, it } from 'vitest';

import { closedDayKeys, weekdayToDayKey } from '../closed-days';

const OPEN = { open: '09:00', close: '18:00', closed: false };
const CLOSED = { open: '09:00', close: '18:00', closed: true };

describe('closedDayKeys — non-working days from businessHours (Prompt 22 §4.2)', () => {
  it('returns fri + sat when both are marked closed (clinic weekend)', () => {
    const hours = {
      sun: OPEN,
      mon: OPEN,
      tue: OPEN,
      wed: OPEN,
      thu: OPEN,
      fri: CLOSED,
      sat: CLOSED,
    };
    expect(closedDayKeys(hours)).toEqual(['fri', 'sat']);
  });

  it('returns [] when no day is closed', () => {
    const hours = { sun: OPEN, mon: OPEN, tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN };
    expect(closedDayKeys(hours)).toEqual([]);
  });

  it('returns [] for null / undefined payloads', () => {
    expect(closedDayKeys(null)).toEqual([]);
    expect(closedDayKeys(undefined)).toEqual([]);
  });

  it('returns [] for malformed JSON-ish payloads (string / number / array)', () => {
    expect(closedDayKeys('{"fri":{"closed":true}}')).toEqual([]);
    expect(closedDayKeys(42)).toEqual([]);
    expect(closedDayKeys([{ closed: true }])).toEqual([]);
  });

  it('ignores malformed day entries and non-boolean closed flags', () => {
    const hours = {
      sun: OPEN,
      mon: 'closed', // not an object
      tue: null,
      wed: { closed: 'yes' }, // truthy but not `true`
      thu: [CLOSED], // array, not a day object
      fri: CLOSED,
      sat: { closed: true }, // minimal but valid
    };
    expect(closedDayKeys(hours)).toEqual(['fri', 'sat']);
  });

  it('ignores unknown keys and preserves week order (sun…sat)', () => {
    const hours = { sat: CLOSED, holiday: CLOSED, sun: CLOSED };
    expect(closedDayKeys(hours)).toEqual(['sun', 'sat']);
  });
});

describe('weekdayToDayKey — recurrence Weekday → settings DayKey', () => {
  it('maps every SUN…SAT to its lowercase day key', () => {
    expect(
      (['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const).map(weekdayToDayKey),
    ).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
  });
});
