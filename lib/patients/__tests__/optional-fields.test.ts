import { describe, expect, it } from 'vitest';

import { patientCreateSchema } from '../schemas';

/**
 * Updated (not deleted) across three eras, per the working rule of keeping
 * decision history visible:
 *   - July #10 (P25): Arabic name + address became optional.
 *   - P50: either name alone was valid (the real clinic's records are
 *     Arabic-only).
 *   - Prompt 47 row 8 (closes the QA sheet): the Arabic-name FIELD is gone —
 *     English is required and is the only accepted name; a stale client
 *     sending fullNameAr has it STRIPPED (never written). The DB column and
 *     legacy data stay untouched (non-destructive; display-level fallback
 *     lives in lib/format/patientName.ts).
 */
const base = {
  fullNameEn: 'John Doe',
  phone: '+962791234567',
  dateOfBirth: '2000-01-01',
  gender: 'MALE',
};

describe('patientCreateSchema — English-only name (P47 row 8) + optional address', () => {
  it('accepts a patient with English name only and no address', () => {
    const r = patientCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.address).toBe(''); // address stays optional (P25 regression)
      expect('fullNameAr' in r.data).toBe(false); // the field no longer exists
    }
  });

  it('strips a smuggled fullNameAr instead of accepting it', () => {
    const r = patientCreateSchema.safeParse({ ...base, fullNameAr: 'جون دو' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('fullNameAr' in r.data).toBe(false);
    }
  });

  it('rejects a patient with no English name (Arabic alone is no longer enough)', () => {
    const { fullNameEn: _omit, ...noEn } = base;
    expect(patientCreateSchema.safeParse(noEn).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...noEn, fullNameAr: 'سارة خليل' }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, fullNameEn: '  ' }).success).toBe(false);
  });

  it('address still accepted when provided (P25 regression)', () => {
    const r = patientCreateSchema.safeParse({ ...base, address: '12 Rainbow St, Amman' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.address).toBe('12 Rainbow St, Amman');
  });

  it('phone accepts general E.164 — international numbers are valid (P52 owner ruling)', () => {
    const qatar = patientCreateSchema.safeParse({ ...base, phone: '+97433991799' });
    expect(qatar.success).toBe(true);
    if (qatar.success) expect(qatar.data.phone).toBe('+97433991799');
    expect(patientCreateSchema.safeParse({ ...base, phone: '+962791234567' }).success).toBe(true);
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
    expect(patientCreateSchema.safeParse({ ...base, phone: '0791234' }).success).toBe(false);
  });
});
