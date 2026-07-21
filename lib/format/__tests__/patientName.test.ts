import { describe, expect, it } from 'vitest';

import { patientDisplayName } from '../patientName';

/**
 * July change request #10 — the Arabic name is optional; a patient must never
 * render blank in the Arabic UI. patientDisplayName falls back to the always-
 * present English name.
 */
describe('patientDisplayName', () => {
  it('uses the Arabic name in the Arabic UI when present', () => {
    expect(patientDisplayName('John Doe', 'جون دو', 'ar')).toBe('جون دو');
  });

  it('falls back to English in the Arabic UI when the Arabic name is empty', () => {
    expect(patientDisplayName('John Doe', '', 'ar')).toBe('John Doe');
  });

  it('falls back to English when the Arabic name is null or whitespace', () => {
    expect(patientDisplayName('John Doe', null, 'ar')).toBe('John Doe');
    expect(patientDisplayName('John Doe', undefined, 'ar')).toBe('John Doe');
    expect(patientDisplayName('John Doe', '   ', 'ar')).toBe('John Doe');
  });

  it('always uses the English name in the English UI', () => {
    expect(patientDisplayName('John Doe', 'جون دو', 'en')).toBe('John Doe');
    expect(patientDisplayName('John Doe', '', 'en')).toBe('John Doe');
  });
});
