import { describe, expect, it } from 'vitest';

import { patientCreateSchema } from '../schemas';

/**
 * July change request #10 — Arabic name and address become optional; English
 * name stays required.
 */
const base = {
  fullNameEn: 'John Doe',
  phone: '+962791234567',
  dateOfBirth: '2000-01-01',
  gender: 'MALE',
};

describe('patientCreateSchema — optional Arabic name + address', () => {
  it('accepts a patient with no Arabic name and no address', () => {
    const r = patientCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.fullNameAr).toBe(''); // defaulted, not undefined
      expect(r.data.address).toBe('');
    }
  });

  it('accepts explicit empty strings for Arabic name and address', () => {
    const r = patientCreateSchema.safeParse({ ...base, fullNameAr: '', address: '' });
    expect(r.success).toBe(true);
  });

  it('still accepts them when provided', () => {
    const r = patientCreateSchema.safeParse({
      ...base,
      fullNameAr: 'جون دو',
      address: '12 Rainbow St, Amman',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.fullNameAr).toBe('جون دو');
      expect(r.data.address).toBe('12 Rainbow St, Amman');
    }
  });

  it('still REQUIRES the English name', () => {
    expect(patientCreateSchema.safeParse({ ...base, fullNameEn: '' }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, fullNameEn: 'ab' }).success).toBe(false);
    const { fullNameEn: _omit, ...noEn } = base;
    expect(patientCreateSchema.safeParse(noEn).success).toBe(false);
  });
});
