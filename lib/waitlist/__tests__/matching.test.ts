import { describe, expect, it } from 'vitest';

import { isExpired, matchWaitlistEntries, type WaitlistCandidate } from '../matching';

const NOW = new Date('2026-06-19T00:00:00Z');

function candidate(over: Partial<WaitlistCandidate> = {}): WaitlistCandidate {
  return {
    id: 'w1',
    windowStart: new Date('2026-06-20T13:00:00Z'),
    windowEnd: new Date('2026-06-20T14:00:00Z'),
    preferredTherapistId: null,
    status: 'WAITING',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...over,
  };
}

const slot = (over: { startsAt?: Date; therapistId?: string } = {}) => ({
  startsAt: new Date('2026-06-20T13:30:00Z'),
  therapistId: 'th-1',
  ...over,
});

describe('matchWaitlistEntries', () => {
  it('matches a freed slot whose start falls inside the window', () => {
    expect(matchWaitlistEntries(slot(), [candidate()], NOW)).toHaveLength(1);
  });

  it('does not match a slot before the window', () => {
    expect(
      matchWaitlistEntries(
        slot({ startsAt: new Date('2026-06-20T12:00:00Z') }),
        [candidate()],
        NOW,
      ),
    ).toHaveLength(0);
  });

  it('treats windowEnd as exclusive', () => {
    expect(
      matchWaitlistEntries(
        slot({ startsAt: new Date('2026-06-20T14:00:00Z') }),
        [candidate()],
        NOW,
      ),
    ).toHaveLength(0);
  });

  it('does not match a non-overlapping window (waitlist 10:00, freed 16:00)', () => {
    const tenAm = candidate({
      windowStart: new Date('2026-06-20T10:00:00Z'),
      windowEnd: new Date('2026-06-20T10:30:00Z'),
    });
    expect(
      matchWaitlistEntries(slot({ startsAt: new Date('2026-06-20T16:00:00Z') }), [tenAm], NOW),
    ).toHaveLength(0);
  });

  it('respects a therapist preference', () => {
    const prefersTh2 = candidate({ preferredTherapistId: 'th-2' });
    expect(matchWaitlistEntries(slot({ therapistId: 'th-1' }), [prefersTh2], NOW)).toHaveLength(0);
    expect(matchWaitlistEntries(slot({ therapistId: 'th-2' }), [prefersTh2], NOW)).toHaveLength(1);
  });

  it('skips entries that are not WAITING', () => {
    expect(matchWaitlistEntries(slot(), [candidate({ status: 'FULFILLED' })], NOW)).toHaveLength(0);
  });

  it('never matches an already-passed (expired) window', () => {
    const passed = candidate({
      windowStart: new Date('2026-06-18T13:00:00Z'),
      windowEnd: new Date('2026-06-18T14:00:00Z'),
    });
    expect(
      matchWaitlistEntries(slot({ startsAt: new Date('2026-06-18T13:30:00Z') }), [passed], NOW),
    ).toHaveLength(0);
  });

  it('orders multiple matches oldest-first (FIFO)', () => {
    const older = candidate({ id: 'older', createdAt: new Date('2026-06-01T00:00:00Z') });
    const newer = candidate({ id: 'newer', createdAt: new Date('2026-06-10T00:00:00Z') });
    const result = matchWaitlistEntries(slot(), [newer, older], NOW);
    expect(result.map((r) => r.id)).toEqual(['older', 'newer']);
  });
});

describe('isExpired', () => {
  it('is true once a WAITING entry window has passed', () => {
    expect(isExpired({ status: 'WAITING', windowEnd: new Date('2026-06-18T14:00:00Z') }, NOW)).toBe(
      true,
    );
  });
  it('is false while the window is still in the future', () => {
    expect(isExpired({ status: 'WAITING', windowEnd: new Date('2026-06-20T14:00:00Z') }, NOW)).toBe(
      false,
    );
  });
  it('is false for non-WAITING entries regardless of time', () => {
    expect(
      isExpired({ status: 'FULFILLED', windowEnd: new Date('2026-06-18T14:00:00Z') }, NOW),
    ).toBe(false);
  });
});
