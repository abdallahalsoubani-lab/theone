import { describe, expect, it } from 'vitest';

import { dayKeyOfDate, rowInstant, validateBatchRows } from '../batch-validation';

/**
 * July 31 item 4 — client-side row validation for the batch modal. Pure
 * UX-layer mirror of the server rules: past + closed-day instant feedback
 * (native date inputs can't grey out weekdays), completeness, duplicates,
 * and the batch-internal overlap.
 */

const NOW = new Date('2026-08-02T09:00:00Z'); // Sunday 12:00 Amman

const row = (over: Record<string, unknown> = {}) => ({
  date: '2026-08-09', // next Sunday
  time: '10:00',
  therapistIds: ['t1'],
  roomId: 'r1',
  durationMinutes: 60,
  ...over,
});

const opts = { closedDays: ['fri'] as const, now: NOW };

describe('dayKeyOfDate', () => {
  it('maps a calendar date to its weekday key', () => {
    expect(dayKeyOfDate('2026-08-07')).toBe('fri');
    expect(dayKeyOfDate('2026-08-09')).toBe('sun');
    expect(dayKeyOfDate('')).toBeNull();
  });
});

describe('rowInstant', () => {
  it('is null while date/time incomplete, a clinic-wall instant when set', () => {
    expect(rowInstant({ date: '', time: '10:00' })).toBeNull();
    // 10:00 Amman (UTC+3 in summer) = 07:00Z.
    expect(rowInstant({ date: '2026-08-09', time: '10:00' })?.toISOString()).toBe(
      '2026-08-09T07:00:00.000Z',
    );
  });
});

describe('validateBatchRows', () => {
  it('a complete future row on a working day is clean', () => {
    expect(validateBatchRows([row()], opts)).toEqual([[]]);
  });

  it('flags incomplete rows without piling on other issues', () => {
    expect(validateBatchRows([row({ roomId: '' })], opts)).toEqual([['incomplete']]);
    expect(validateBatchRows([row({ therapistIds: [] })], opts)).toEqual([['incomplete']]);
    expect(validateBatchRows([row({ date: '' })], opts)).toEqual([['incomplete']]);
  });

  it('flags a below-floor duration', () => {
    expect(validateBatchRows([row({ durationMinutes: 10 })], opts)).toEqual([['durationTooShort']]);
  });

  it('flags a clinic holiday (settings-driven closed weekday)', () => {
    expect(validateBatchRows([row({ date: '2026-08-07' })], opts)).toEqual([['closedDay']]);
  });

  it('flags a past start', () => {
    expect(validateBatchRows([row({ date: '2026-07-26' })], opts)).toEqual([['pastDate']]);
  });

  it('flags the LATER of two identical rows as the duplicate', () => {
    expect(validateBatchRows([row(), row()], opts)).toEqual([[], ['duplicateRow']]);
  });

  it('flags duration-aware overlap on the same date (different therapist/room still blocked)', () => {
    const res = validateBatchRows(
      [row(), row({ time: '10:30', therapistIds: ['t2'], roomId: 'r2' })],
      opts,
    );
    expect(res).toEqual([[], ['overlappingRows']]);
  });

  it('same date at non-overlapping times is fine (explicitly wanted)', () => {
    expect(validateBatchRows([row(), row({ time: '14:00', therapistIds: ['t2'] })], opts)).toEqual([
      [],
      [],
    ]);
  });
});
