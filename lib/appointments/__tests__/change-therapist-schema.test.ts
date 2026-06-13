import { describe, expect, it } from 'vitest';

import { appointmentChangeTherapistSchema } from '../schemas';

const id = 'cl' + 'a'.repeat(23);

describe('appointmentChangeTherapistSchema', () => {
  it('accepts a minimal payload', () => {
    expect(
      appointmentChangeTherapistSchema.safeParse({
        id,
        therapistIds: [id],
      }).success,
    ).toBe(true);
  });

  it('accepts an optional reason', () => {
    const r = appointmentChangeTherapistSchema.parse({
      id,
      therapistIds: [id],
      reason: 'patient requested male therapist',
    });
    expect(r.reason).toBe('patient requested male therapist');
  });

  it('caps reason at 500 characters', () => {
    expect(
      appointmentChangeTherapistSchema.safeParse({
        id,
        therapistIds: [id],
        reason: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('defaults overrideConflicts to false', () => {
    const r = appointmentChangeTherapistSchema.parse({
      id,
      therapistIds: [id],
    });
    expect(r.overrideConflicts).toBe(false);
  });

  it('rejects an empty therapist id', () => {
    // The schema accepts any non-empty string (DB foreign-key enforces real
    // existence). Empty string is still invalid.
    expect(
      appointmentChangeTherapistSchema.safeParse({
        id,
        therapistIds: [''],
      }).success,
    ).toBe(false);
  });

  it('rejects zero therapists (min 1 — Prompt 20)', () => {
    expect(
      appointmentChangeTherapistSchema.safeParse({
        id,
        therapistIds: [],
      }).success,
    ).toBe(false);
  });
});
