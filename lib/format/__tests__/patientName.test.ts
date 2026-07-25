import { describe, expect, it } from 'vitest';

import { patientDisplayName } from '../patientName';

/**
 * P50 — BIDIRECTIONAL fallback (replaces the P25 "English required" rule):
 * either name alone is valid; each UI prefers its own script and falls back
 * to the other so a patient never renders blank.
 */
describe('patientDisplayName', () => {
  it('prefers the matching script when both names exist', () => {
    expect(patientDisplayName('John Doe', 'جون دو', 'ar')).toBe('جون دو');
    expect(patientDisplayName('John Doe', 'جون دو', 'en')).toBe('John Doe');
  });

  it('Arabic UI falls back to English when Arabic is missing', () => {
    expect(patientDisplayName('John Doe', '', 'ar')).toBe('John Doe');
    expect(patientDisplayName('John Doe', null, 'ar')).toBe('John Doe');
    expect(patientDisplayName('John Doe', '   ', 'ar')).toBe('John Doe');
  });

  it('English UI falls back to Arabic when English is missing (P50)', () => {
    expect(patientDisplayName('', 'سارة خليل', 'en')).toBe('سارة خليل');
    expect(patientDisplayName(null, 'سارة خليل', 'en')).toBe('سارة خليل');
    expect(patientDisplayName('  ', 'سارة خليل', 'en')).toBe('سارة خليل');
  });

  it('Arabic-only patient renders in both UIs', () => {
    expect(patientDisplayName('', 'سارة خليل', 'ar')).toBe('سارة خليل');
    expect(patientDisplayName('', 'سارة خليل', 'en')).toBe('سارة خليل');
  });
});
