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

  // P50 reversal: EN alone, AR alone — either is enough; neither is not.
  it('accepts an ARABIC-ONLY patient (the real clinic records)', () => {
    const { fullNameEn: _omit, ...noEn } = base;
    const r = patientCreateSchema.safeParse({ ...noEn, fullNameAr: 'سارة خليل' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.fullNameEn).toBe('');
  });

  it('rejects a patient with NEITHER name', () => {
    const { fullNameEn: _omit, ...noEn } = base;
    expect(patientCreateSchema.safeParse(noEn).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...noEn, fullNameAr: '  ' }).success).toBe(false);
  });

  it('phone accepts general E.164 — international numbers are valid (P52 owner ruling)', () => {
    // A Qatari number (two imported patients share one) passes the EDIT form.
    const qatar = patientCreateSchema.safeParse({ ...base, phone: '+97433991799' });
    expect(qatar.success).toBe(true);
    if (qatar.success) expect(qatar.data.phone).toBe('+97433991799');
    // Jordanian still passes.
    expect(patientCreateSchema.safeParse({ ...base, phone: '+962791234567' }).success).toBe(true);
    // A string that is no phone anywhere still fails.
    expect(patientCreateSchema.safeParse({ ...base, phone: '+0123' }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, phone: '0791234567' }).success).toBe(false);
  });

  it('dateOfBirth accepts a date-only string and rejects the future (existing rule)', () => {
    expect(patientCreateSchema.safeParse({ ...base, dateOfBirth: '1984-01-01' }).success).toBe(
      true,
    );
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(patientCreateSchema.safeParse({ ...base, dateOfBirth: future }).success).toBe(false);
  });

  it('phone is optional and empty-string normalizes to null (P50)', () => {
    const { phone: _p, ...noPhone } = base;
    const r1 = patientCreateSchema.safeParse(noPhone);
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data.phone).toBeNull();
    const r2 = patientCreateSchema.safeParse({ ...base, phone: '' });
    expect(r2.success).toBe(true);
    if (r2.success) expect(r2.data.phone).toBeNull();
    // A malformed phone is still rejected when provided.
    expect(patientCreateSchema.safeParse({ ...base, phone: '0791234' }).success).toBe(false);
  });
});
