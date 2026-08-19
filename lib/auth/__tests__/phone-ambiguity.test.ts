import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P50 (revised) §5.2 — patient phones are no longer unique (families share a
 * number). OTP login must resolve to exactly ONE active patient; two or more
 * matches are refused (the caller surfaces the localized "contact the clinic"
 * error) instead of authenticating whichever row sorts first.
 */

const state = {
  rows: [] as Array<{ id: string }>,
};

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(async ({ take }: { take: number }) => state.rows.slice(0, take)),
    },
  },
}));

import { lookupPatientByPhone } from '../lockout';

describe('lookupPatientByPhone — shared-number ambiguity guard (P50 §5.2)', () => {
  beforeEach(() => {
    state.rows = [];
  });

  it('returns NONE for an unknown number', async () => {
    const result = await lookupPatientByPhone('+962790000000');
    expect(result.outcome).toBe('NONE');
  });

  it('returns the single matching patient', async () => {
    state.rows = [{ id: 'patient-1' }];
    const result = await lookupPatientByPhone('+962790000000');
    expect(result.outcome).toBe('ONE');
    if (result.outcome === 'ONE') expect(result.user.id).toBe('patient-1');
  });

  it('returns AMBIGUOUS — never an arbitrary user — when two patients share the number', async () => {
    state.rows = [{ id: 'sibling-1' }, { id: 'sibling-2' }];
    const result = await lookupPatientByPhone('+962790000000');
    expect(result.outcome).toBe('AMBIGUOUS');
    expect('user' in result).toBe(false);
  });
});
