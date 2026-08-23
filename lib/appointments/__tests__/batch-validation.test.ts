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
  appointmentType: 'SESSION' as const,
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

describe('recurring-booking day rules (PT-B3 item 2)', () => {
  // The owner's three rules, checked against the booking model that actually
  // ships. The weekday-chip picker those rules were written for was replaced
  // on 31 Jul by one explicit row per appointment, which changes what each
  // rule means — see the batch's own structure below.
  const weekend = { closedDays: ['fri', 'sat'] as const, now: NOW };

  it('rule 3 — every closed weekday the admin configured is rejected, not just Friday', () => {
    const issues = validateBatchRows(
      [
        row({ date: '2026-08-07' }), // Friday
        row({ date: '2026-08-08', time: '11:00' }), // Saturday
        row({ date: '2026-08-09', time: '12:00' }), // Sunday — open
      ],
      weekend,
    );
    expect(issues[0]).toContain('closedDay');
    expect(issues[1]).toContain('closedDay');
    expect(issues[2]).not.toContain('closedDay');
  });

  it('rule 3 — the rule follows the settings, so a clinic that opens Friday can book it', () => {
    const openAllWeek = { closedDays: [] as const, now: NOW };
    const issues = validateBatchRows([row({ date: '2026-08-07' })], openAllWeek);
    expect(issues[0]).not.toContain('closedDay');
  });

  it('rule 1 — days used can never exceed the appointment count: one row is one day', () => {
    // In the explicit-row model each row books exactly one appointment on one
    // date, so distinct days <= rows by construction. Three rows spread over
    // three dates is the maximum spread three appointments can have.
    const rows = [
      row({ date: '2026-08-09' }),
      row({ date: '2026-08-10', time: '11:00' }),
      row({ date: '2026-08-11', time: '12:00' }),
    ];
    const issues = validateBatchRows(rows, weekend);
    const distinctDays = new Set(rows.map((r) => r.date)).size;
    expect(distinctDays).toBeLessThanOrEqual(rows.length);
    expect(issues.every((list) => list.length === 0)).toBe(true);
  });

  it('rule 2 — days used can never exceed the clinic working week: closed days are unbookable', () => {
    // Every bookable row falls on an open weekday (rule 3), so the set of
    // weekdays a batch can occupy is a subset of the clinic's working days.
    const everyDayOfOneWeek = [
      '2026-08-09', // sun
      '2026-08-10', // mon
      '2026-08-11', // tue
      '2026-08-12', // wed
      '2026-08-13', // thu
      '2026-08-14', // fri — closed
      '2026-08-15', // sat — closed
    ].map((date, i) => row({ date, time: `${String(9 + i).padStart(2, '0')}:00` }));

    const issues = validateBatchRows(everyDayOfOneWeek, weekend);
    const bookableWeekdays = everyDayOfOneWeek
      .filter((_, i) => !issues[i]!.includes('closedDay'))
      .map((r) => dayKeyOfDate(r.date));
    expect(bookableWeekdays).toEqual(['sun', 'mon', 'tue', 'wed', 'thu']);
    expect(bookableWeekdays).toHaveLength(5); // the clinic's 5 working days
  });
});

describe('per-row booking type (Prompt 51) — same rules as the single modal', () => {
  it('a STRETCHING row is complete WITHOUT therapists (room + beds)', () => {
    const r = row({ appointmentType: 'STRETCHING', therapistIds: [] });
    expect(validateBatchRows([r], opts)).toEqual([[]]);
  });

  it('a STRETCHING row still needs its room', () => {
    const r = row({ appointmentType: 'STRETCHING', therapistIds: [], roomId: '' });
    expect(validateBatchRows([r], opts)).toEqual([['incomplete']]);
  });

  it('a STRETCHING row WITH a therapist is flagged (stretchingNoTherapist)', () => {
    const r = row({ appointmentType: 'STRETCHING', therapistIds: ['t1'] });
    expect(validateBatchRows([r], opts)).toEqual([['stretchingNoTherapist']]);
  });

  it('a SESSION row with zero therapists is still incomplete', () => {
    expect(validateBatchRows([row({ therapistIds: [] })], opts)).toEqual([['incomplete']]);
  });

  it('a mixed clean batch (session + stretching, different times) is clean', () => {
    const a = row();
    const b = row({ time: '12:00', appointmentType: 'STRETCHING', therapistIds: [], roomId: 'r2' });
    expect(validateBatchRows([a, b], opts)).toEqual([[], []]);
  });

  it('two STRETCHING rows at the same instant + room are duplicates (type-agnostic key)', () => {
    const a = row({ appointmentType: 'STRETCHING', therapistIds: [] });
    const b = row({ appointmentType: 'STRETCHING', therapistIds: [] });
    expect(validateBatchRows([a, b], opts)).toEqual([[], ['duplicateRow']]);
  });
});
