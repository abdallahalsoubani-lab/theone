import { describe, expect, it } from 'vitest';

import { kioskNamePair } from '../name-pair';

/**
 * Fix 45.1 — every kiosk row gets exactly one filled primary slot; the
 * secondary appears only when the other script exists and differs. The
 * production bug: an English-only patient in /ar rendered an EMPTY primary
 * and their name in the small secondary style.
 */

const BOTH = { fullNameEn: 'Yasmin Al Momani', fullNameAr: 'ياسمين المومني' };
const EN_ONLY = { fullNameEn: 'Rawan Ababneh', fullNameAr: '' };
const AR_ONLY = { fullNameEn: '', fullNameAr: 'عبدالله خليل' };
const DUPLICATED = { fullNameEn: 'Abdullah Soubani', fullNameAr: 'Abdullah Soubani' };

describe('kioskNamePair', () => {
  it('both scripts in /ar → Arabic primary, English secondary', () => {
    expect(kioskNamePair(BOTH, 'ar')).toEqual({
      primary: 'ياسمين المومني',
      alt: 'Yasmin Al Momani',
    });
  });

  it('both scripts in /en → English primary, Arabic secondary', () => {
    expect(kioskNamePair(BOTH, 'en')).toEqual({
      primary: 'Yasmin Al Momani',
      alt: 'ياسمين المومني',
    });
  });

  it('English-only patient in /ar → English PROMOTED to primary, no secondary (the bug)', () => {
    expect(kioskNamePair(EN_ONLY, 'ar')).toEqual({ primary: 'Rawan Ababneh', alt: null });
  });

  it('Arabic-only patient in /en → Arabic promoted to primary, no secondary', () => {
    expect(kioskNamePair(AR_ONLY, 'en')).toEqual({ primary: 'عبدالله خليل', alt: null });
  });

  it('same string in both fields → no duplicate secondary line', () => {
    expect(kioskNamePair(DUPLICATED, 'ar')).toEqual({ primary: 'Abdullah Soubani', alt: null });
    expect(kioskNamePair(DUPLICATED, 'en')).toEqual({ primary: 'Abdullah Soubani', alt: null });
  });

  it('whitespace-only other script never creates a secondary line', () => {
    expect(kioskNamePair({ fullNameEn: 'Rawan', fullNameAr: '  ' }, 'ar')).toEqual({
      primary: 'Rawan',
      alt: null,
    });
  });
});
