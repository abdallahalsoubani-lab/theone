import { describe, expect, it } from 'vitest';

import { publicProfileSchema } from '../schemas';

/**
 * P47 row 8 (updates QA 5.2): the public profile collects ONE name field
 * (English, required); a stale client's fullNameAr is stripped. Preferred
 * language (QA 5.3) unchanged.
 */

const validProfile = {
  fullNameEn: 'Yousef Al-Najjar',
  phone: '0790000000',
  dateOfBirth: '1990-01-01',
  gender: 'MALE',
  languagePref: 'AR',
  address: '123 Main Street',
  email: '',
};

describe('publicProfileSchema — single English name (P47 row 8)', () => {
  it('accepts the profile and strips a smuggled fullNameAr', () => {
    const parsed = publicProfileSchema.parse({ ...validProfile, fullNameAr: 'يوسف النجار' });
    expect(parsed.fullNameEn).toBe('Yousef Al-Najjar');
    expect('fullNameAr' in parsed).toBe(false);
  });

  it('rejects a missing, empty, or too-short name', () => {
    const { fullNameEn: _omitted, ...withoutName } = validProfile;
    expect(publicProfileSchema.safeParse(withoutName).success).toBe(false);
    expect(publicProfileSchema.safeParse({ ...validProfile, fullNameEn: '' }).success).toBe(false);
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

describe('publicProfileSchema — optional address (PT-B4 item 2)', () => {
  /**
   * A patient filling this on a phone should not be blocked by an address the
   * clinic can just as easily take at the desk. Mirrors the same relaxation
   * already made for the staff patient form (patientCreateSchema).
   */
  it('accepts a submission with the address omitted entirely', () => {
    const { address: _omitted, ...withoutAddress } = validProfile;
    const parsed = publicProfileSchema.parse(withoutAddress);
    expect(parsed.address).toBe('');
  });

  it('accepts an empty address', () => {
    expect(publicProfileSchema.parse({ ...validProfile, address: '' }).address).toBe('');
  });

  it('accepts a short address that the old min(5) rule rejected', () => {
    expect(publicProfileSchema.parse({ ...validProfile, address: 'خلدا' }).address).toBe('خلدا');
  });

  it('still keeps and trims a real address', () => {
    expect(publicProfileSchema.parse({ ...validProfile, address: '  Amman  ' }).address).toBe(
      'Amman',
    );
  });

  it('still rejects an address beyond the column bound', () => {
    expect(
      publicProfileSchema.safeParse({ ...validProfile, address: 'x'.repeat(501) }).success,
    ).toBe(false);
  });

  it('leaving the address out does not relax any other required field', () => {
    const { address: _a, ...withoutAddress } = validProfile;
    expect(publicProfileSchema.safeParse({ ...withoutAddress, fullNameEn: '' }).success).toBe(
      false,
    );
    expect(publicProfileSchema.safeParse({ ...withoutAddress, phone: '' }).success).toBe(false);
    expect(publicProfileSchema.safeParse({ ...withoutAddress, dateOfBirth: '' }).success).toBe(
      false,
    );
  });
});
