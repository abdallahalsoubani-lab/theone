import { describe, expect, it } from 'vitest';

import { appointmentChangeTherapistSchema } from '../schemas';

const id = 'cl' + 'a'.repeat(23);

describe('appointmentChangeTherapistSchema', () => {
  it('accepts a minimal payload', () => {
    expect(
      appointmentChangeTherapistSchema.safeParse({
        id,
        therapistId: id,
      }).success,
    ).toBe(true);
  });

  it('accepts an optional reason', () => {
    const r = appointmentChangeTherapistSchema.parse({
      id,
      therapistId: id,
      reason: 'patient requested male therapist',
    });
    expect(r.reason).toBe('patient requested male therapist');
  });

  it('caps reason at 500 characters', () => {
    expect(
      appointmentChangeTherapistSchema.safeParse({
        id,
        therapistId: id,
        reason: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('defaults overrideConflicts to false', () => {
    const r = appointmentChangeTherapistSchema.parse({
      id,
      therapistId: id,
    });
    expect(r.overrideConflicts).toBe(false);
  });

  it('rejects non-cuid therapistId', () => {
    expect(
      appointmentChangeTherapistSchema.safeParse({
        id,
        therapistId: 'not-a-cuid',
      }).success,
    ).toBe(false);
  });
});
