import { describe, expect, it } from 'vitest';

import {
  canStartSessionAt,
  earliestSessionStart,
  isSessionOverdue,
  isStartInPast,
  sessionStartTooEarly,
} from '../session-timing';

const MIN = 60_000;
const GRACE = 15;

describe('canStartSessionAt — start gate (grace 15min)', () => {
  const start = new Date('2026-06-01T16:00:00Z');

  it('rejects 20 min before start (Receptionist #11)', () => {
    expect(canStartSessionAt(new Date(start.getTime() - 20 * MIN), start, GRACE)).toBe(false);
  });

  it('allows 10 min before start (inside window)', () => {
    expect(canStartSessionAt(new Date(start.getTime() - 10 * MIN), start, GRACE)).toBe(true);
  });

  it('allows exactly at start', () => {
    expect(canStartSessionAt(new Date(start.getTime()), start, GRACE)).toBe(true);
  });

  it('allows exactly at the grace edge (start − 15min)', () => {
    expect(canStartSessionAt(new Date(start.getTime() - GRACE * MIN), start, GRACE)).toBe(true);
  });

  it('TZ regression guard: a UTC start that is 09:00 Amman starts cleanly inside the window', () => {
    // 06:00Z === 09:00 Asia/Amman (UTC+3). A naive wall-clock comparison could
    // mis-handle this; the instant-vs-instant gate does not. now = 08:50 Amman
    // (05:50Z) is start−10min → inside the 15-min window.
    const ammanStart = new Date('2026-06-01T06:00:00Z');
    expect(canStartSessionAt(new Date('2026-06-01T05:50:00Z'), ammanStart, GRACE)).toBe(true);
    expect(canStartSessionAt(new Date('2026-06-01T05:40:00Z'), ammanStart, GRACE)).toBe(false);
  });
});

describe('sessionStartTooEarly', () => {
  it('names the earliest allowed time in clinic-local (Asia/Amman)', () => {
    const start = new Date('2026-06-01T06:00:00Z'); // 09:00 Amman
    const earliest = earliestSessionStart(start, GRACE); // 05:45Z = 08:45 Amman
    const err = sessionStartTooEarly(earliest, 'Asia/Amman');
    expect(err.code).toBe('SESSION_START_TOO_EARLY');
    expect(err.message_en).toContain('08:45');
    expect(err.message_ar).toContain('08:45');
  });
});

describe('isSessionOverdue — auto-complete threshold (grace 15min)', () => {
  const start = new Date('2026-06-01T13:00:00Z');
  const duration = 30; // ends 13:30Z

  it('overdue when ended 20 min ago (Receptionist #21)', () => {
    // end = 13:30, +15 grace = 13:45; now = 13:50 (ended 20 min ago) → overdue.
    const now = new Date('2026-06-01T13:50:00Z');
    expect(isSessionOverdue(now, start, duration, GRACE)).toBe(true);
  });

  it('not overdue when ended 5 min ago (inside grace)', () => {
    // end = 13:30; now = 13:35 → only 5 min past end, < 15 grace.
    const now = new Date('2026-06-01T13:35:00Z');
    expect(isSessionOverdue(now, start, duration, GRACE)).toBe(false);
  });

  it('overdue exactly at end + grace (boundary inclusive)', () => {
    const now = new Date('2026-06-01T13:45:00Z');
    expect(isSessionOverdue(now, start, duration, GRACE)).toBe(true);
  });
});

describe('isStartInPast — booking past-time guard (Fix 6C item 1)', () => {
  const now = new Date('2026-06-01T14:00:00Z');

  it('rejects a start before now (Receptionist #9)', () => {
    expect(isStartInPast(new Date('2026-06-01T13:45:00Z'), now)).toBe(true);
  });

  it('allows a start exactly at now', () => {
    expect(isStartInPast(new Date('2026-06-01T14:00:00Z'), now)).toBe(false);
  });

  it('allows a future start (later today or another day)', () => {
    expect(isStartInPast(new Date('2026-06-01T14:15:00Z'), now)).toBe(false);
    expect(isStartInPast(new Date('2026-06-02T09:00:00Z'), now)).toBe(false);
  });

  it('is tz-independent — a past instant is past however it is expressed', () => {
    // 11:00 Amman (08:00Z) is before 14:00Z now → past, regardless of zone.
    expect(isStartInPast(new Date('2026-06-01T08:00:00Z'), now)).toBe(true);
  });
});
