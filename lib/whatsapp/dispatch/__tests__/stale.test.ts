import { describe, expect, it } from 'vitest';

import { isStale, type StaleCheckInput } from '../stale';

/**
 * P51 §4.5 — the staleness rule, exhaustively: a held message must not
 * outlive its moment. Pure; evaluated at outbox render (label) and at Send
 * (mark STALE + skip).
 */
const NOW = new Date('2030-05-10T10:00:00Z');
const MIN = 60_000;
const at = (deltaMin: number) => new Date(NOW.getTime() + deltaMin * MIN);

const base = (over: Partial<StaleCheckInput>): StaleCheckInput => ({
  type: 'REMINDER',
  status: 'PENDING',
  appointmentStartsAt: at(60),
  appointmentDurationMinutes: 60,
  appointmentStatus: 'SCHEDULED',
  ...over,
});

describe('isStale — REMINDER', () => {
  it('future appointment → fresh', () => {
    expect(isStale(base({}), NOW)).toBe(false);
  });
  it('appointment already started → stale', () => {
    expect(isStale(base({ appointmentStartsAt: at(-1) }), NOW)).toBe(true);
  });
  it('edge: EXACTLY at start → stale (a reminder at start is meaningless)', () => {
    expect(isStale(base({ appointmentStartsAt: NOW }), NOW)).toBe(true);
  });
});

describe('isStale — ARRIVAL', () => {
  it('during the visit → still fresh (same-visit send is useful)', () => {
    expect(
      isStale(base({ type: 'ARRIVAL', appointmentStartsAt: at(-30) }), NOW), // ends at +30
    ).toBe(false);
  });
  it('after the appointment END (start+duration) → stale', () => {
    expect(isStale(base({ type: 'ARRIVAL', appointmentStartsAt: at(-61) }), NOW)).toBe(true);
  });
  it('edge: exactly at end → fresh (strictly older-than-end goes stale)', () => {
    expect(isStale(base({ type: 'ARRIVAL', appointmentStartsAt: at(-60) }), NOW)).toBe(false);
  });
});

describe('isStale — BOOKING_CONFIRMATION', () => {
  it('future + live appointment → fresh', () => {
    expect(isStale(base({ type: 'BOOKING_CONFIRMATION' }), NOW)).toBe(false);
  });
  it('appointment has started/passed → stale', () => {
    expect(isStale(base({ type: 'BOOKING_CONFIRMATION', appointmentStartsAt: NOW }), NOW)).toBe(
      true,
    );
  });
  it('CANCELLED appointment → stale even when still in the future', () => {
    expect(
      isStale(base({ type: 'BOOKING_CONFIRMATION', appointmentStatus: 'CANCELLED' }), NOW),
    ).toBe(true);
  });
});

describe('isStale — never stale by time alone', () => {
  it('a LATE cancellation notice is NOT stale (the patient should still learn of it)', () => {
    expect(isStale(base({ type: 'CANCELLATION', appointmentStartsAt: at(-600) }), NOW)).toBe(false);
  });
  it('a late reschedule notice is NOT stale', () => {
    expect(isStale(base({ type: 'RESCHEDULE', appointmentStartsAt: at(-600) }), NOW)).toBe(false);
  });
  it('HOME_PROGRAM (appointment-less) is never stale by time', () => {
    expect(
      isStale(
        base({ type: 'HOME_PROGRAM', appointmentStartsAt: null, appointmentDurationMinutes: null }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe('isStale — only PENDING rows can be stale', () => {
  it('a SENT/EXCLUDED/SCHEDULED row is never re-flagged', () => {
    for (const status of ['SENT', 'EXCLUDED', 'SCHEDULED', 'SUPERSEDED', 'FAILED'] as const) {
      expect(isStale(base({ status, appointmentStartsAt: at(-600) }), NOW)).toBe(false);
    }
  });
  it('missing appointment data (null start) → not stale for time-based types', () => {
    expect(isStale(base({ appointmentStartsAt: null }), NOW)).toBe(false);
    expect(isStale(base({ type: 'ARRIVAL', appointmentStartsAt: null }), NOW)).toBe(false);
  });
});
