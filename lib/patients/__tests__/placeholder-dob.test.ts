import { describe, expect, it } from 'vitest';

import { hasPlaceholderDob, PLACEHOLDER_DOB } from '../placeholder-dob';

/**
 * P52 — the quick-add DOB placeholder is a single named constant, and
 * hasPlaceholderDob() drives the patient-file "incomplete data" flag. Once
 * the intake link is filled, the real DOB replaces it and the flag clears.
 */
describe('placeholder DOB', () => {
  it('flags the exact placeholder, in Date or ISO form, and clears for a real DOB', () => {
    expect(hasPlaceholderDob(PLACEHOLDER_DOB)).toBe(true);
    expect(hasPlaceholderDob(new Date('1900-01-01T00:00:00.000Z'))).toBe(true);
    expect(hasPlaceholderDob('1900-01-01T00:00:00.000Z')).toBe(true);
    // A real submitted DOB (what the intake link writes) is NOT flagged.
    expect(hasPlaceholderDob(new Date('1990-05-01T00:00:00.000Z'))).toBe(false);
    // Null/undefined (no DOB at all) is not the placeholder.
    expect(hasPlaceholderDob(null)).toBe(false);
    expect(hasPlaceholderDob(undefined)).toBe(false);
  });
});
