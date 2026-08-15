import { describe, expect, it } from 'vitest';

import { patientDisplayName } from '../patientName';

/**
 * Prompt 47 row 8 — English-only rendering (updates, not deletes, the P50
 * bidirectional expectations): the English name is THE display name in both
 * UIs whenever it exists. Stored Arabic names are tolerated as a last-resort
 * fallback ONLY when English is empty — at cutover 258/265 production
 * patients were Arabic-only (P50 rule + P52 import) and must never render
 * as a blank label.
 */
describe('patientDisplayName (English-only, P47 row 8)', () => {
  it('returns English in BOTH UIs when both names exist (no locale preference anymore)', () => {
    expect(patientDisplayName('John Doe', 'جون دو', 'ar')).toBe('John Doe');
    expect(patientDisplayName('John Doe', 'جون دو', 'en')).toBe('John Doe');
    expect(patientDisplayName('John Doe', 'جون دو')).toBe('John Doe');
  });

  it('returns English when Arabic is missing', () => {
    expect(patientDisplayName('John Doe', '', 'ar')).toBe('John Doe');
    expect(patientDisplayName('John Doe', null, 'ar')).toBe('John Doe');
    expect(patientDisplayName('John Doe', '   ', 'ar')).toBe('John Doe');
  });

  it('legacy Arabic-only patient still renders (fallback, never blank) in both UIs', () => {
    expect(patientDisplayName('', 'سارة خليل', 'en')).toBe('سارة خليل');
    expect(patientDisplayName(null, 'سارة خليل', 'ar')).toBe('سارة خليل');
    expect(patientDisplayName('  ', 'سارة خليل', 'en')).toBe('سارة خليل');
  });

  it('never returns whitespace when both are empty', () => {
    expect(patientDisplayName('', '', 'en')).toBe('');
    expect(patientDisplayName(null, undefined, 'ar')).toBe('');
  });
});
