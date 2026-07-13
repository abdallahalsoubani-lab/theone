import { describe, expect, it } from 'vitest';

import { publicProfileSchema } from '../schemas';

/**
 * QA 13/7 items 5.2 + 5.3 — the public profile collects TWO name fields
 * (AR required, EN optional but bounded when provided) and an explicit
 * preferred-language choice (optional in the schema; the service falls back
 * to the form locale for legacy payloads).
 */

const validProfile = {
  fullNameAr: 'يوسف النجار',
  fullNameEn: 'Yousef Al-Najjar',
  phone: '0790000000',
  dateOfBirth: '1990-01-01',
  gender: 'MALE',
  languagePref: 'AR',
  address: '123 Main Street',
  email: '',
};

describe('publicProfileSchema — split names (QA 5.2)', () => {
  it('accepts both names', () => {
    const parsed = publicProfileSchema.parse(validProfile);
    expect(parsed.fullNameAr).toBe('يوسف النجار');
    expect(parsed.fullNameEn).toBe('Yousef Al-Najjar');
  });

  it('rejects an empty or too-short Arabic name', () => {
    expect(publicProfileSchema.safeParse({ ...validProfile, fullNameAr: '' }).success).toBe(false);
    expect(publicProfileSchema.safeParse({ ...validProfile, fullNameAr: 'أب' }).success).toBe(
      false,
    );
  });

  it('accepts a missing or empty English name (optional)', () => {
    const { fullNameEn: _omitted, ...withoutEn } = validProfile;
    expect(publicProfileSchema.safeParse(withoutEn).success).toBe(true);
    expect(publicProfileSchema.safeParse({ ...validProfile, fullNameEn: '' }).success).toBe(true);
  });

  it('validates the English name when provided (min 3, matching patientCreateSchema)', () => {
    expect(publicProfileSchema.safeParse({ ...validProfile, fullNameEn: 'ab' }).success).toBe(
      false,
    );
    expect(
      publicProfileSchema.safeParse({ ...validProfile, fullNameEn: 'x'.repeat(121) }).success,
    ).toBe(false);
  });
});

describe('publicProfileSchema — preferred language (QA 5.3)', () => {
  it('accepts AR and EN', () => {
    expect(publicProfileSchema.parse({ ...validProfile, languagePref: 'AR' }).languagePref).toBe(
      'AR',
    );
    expect(publicProfileSchema.parse({ ...validProfile, languagePref: 'EN' }).languagePref).toBe(
      'EN',
    );
  });

  it('is optional — a legacy payload without it still validates', () => {
    const { languagePref: _omitted, ...withoutPref } = validProfile;
    const parsed = publicProfileSchema.safeParse(withoutPref);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.languagePref).toBeUndefined();
  });

  it('rejects an unknown language value', () => {
    expect(publicProfileSchema.safeParse({ ...validProfile, languagePref: 'FR' }).success).toBe(
      false,
    );
  });
});
