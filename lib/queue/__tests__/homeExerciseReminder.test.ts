import { describe, expect, it } from 'vitest';

import { computeReminderCron } from '../jobs/homeExerciseReminder';

describe('computeReminderCron', () => {
  it('subtracts the offset on a same-day schedule', () => {
    // Exercise at 18:00 on Mon/Wed/Fri (1,3,5), 30-min offset → 17:30.
    const r = computeReminderCron({
      scheduledTime: '18:00',
      daysOfWeek: [1, 3, 5],
      offsetMinutes: 30,
    });
    expect(r.pattern).toBe('30 17 * * 1,3,5');
    expect(r.shiftedDays).toEqual([1, 3, 5]);
  });

  it('handles offset crossing an hour boundary (08:15 - 30 = 07:45)', () => {
    const r = computeReminderCron({
      scheduledTime: '08:15',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      offsetMinutes: 30,
    });
    expect(r.minute).toBe(45);
    expect(r.hour).toBe(7);
    expect(r.pattern).toBe('45 7 * * 0,1,2,3,4,5,6');
  });

  it('rolls back to the previous day for a 00:15 schedule with a 30-min offset', () => {
    // Tue (2) 00:15 - 30min → Mon (1) 23:45. Wed (3) becomes Tue (2).
    const r = computeReminderCron({
      scheduledTime: '00:15',
      daysOfWeek: [2, 3],
      offsetMinutes: 30,
    });
    expect(r.hour).toBe(23);
    expect(r.minute).toBe(45);
    expect(r.shiftedDays).toEqual([1, 2]);
    expect(r.pattern).toBe('45 23 * * 1,2');
  });

  it('rolls Sunday backward to Saturday (wrap-around)', () => {
    // Sun (0) 00:10 - 30min → Sat (6) 23:40.
    const r = computeReminderCron({
      scheduledTime: '00:10',
      daysOfWeek: [0],
      offsetMinutes: 30,
    });
    expect(r.hour).toBe(23);
    expect(r.minute).toBe(40);
    expect(r.shiftedDays).toEqual([6]);
  });

  it('deduplicates shifted days when two adjacent days overlap', () => {
    // Mon (1) and Tue (2) both at 00:00 - 30min → both shift to the
    // previous day, but Sun (0) and Mon (1) are distinct, so the set
    // is [0, 1]. With Mon + Sun + Tue 00:00, shifts give [0, 6, 1]
    // deduped + sorted to [0, 1, 6].
    const r = computeReminderCron({
      scheduledTime: '00:00',
      daysOfWeek: [0, 1, 2],
      offsetMinutes: 30,
    });
    expect(r.hour).toBe(23);
    expect(r.minute).toBe(30);
    expect(r.shiftedDays).toEqual([0, 1, 6]);
  });

  it('respects a 60-minute custom offset', () => {
    const r = computeReminderCron({
      scheduledTime: '09:30',
      daysOfWeek: [1, 3, 5],
      offsetMinutes: 60,
    });
    expect(r.hour).toBe(8);
    expect(r.minute).toBe(30);
    expect(r.pattern).toBe('30 8 * * 1,3,5');
  });
});
