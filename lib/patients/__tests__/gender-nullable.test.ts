import { describe, expect, it } from 'vitest';

import { patientCreateSchema, patientUpdateSchema } from '../schemas';

/**
 * P50 (revised) §4.2(a)/§5.4 — gender is nullable at the DB layer for
 * imported/legacy records ONLY. The create form keeps it required so new
 * registrations never degrade (owner condition, 19 Aug).
 */

const base = {
  fullNameEn: 'John Doe',
  phone: '+962791234567',
  dateOfBirth: '2000-01-01',
};

describe('gender nullability split (P50 revised)', () => {
  it('CREATE still requires gender', () => {
    expect(patientCreateSchema.safeParse(base).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, gender: 'MALE' }).success).toBe(true);
  });

  it('UPDATE accepts a missing/null gender (imported record kept as-is)', () => {
    const missing = patientUpdateSchema.safeParse({ ...base, id: 'p1' });
    expect(missing.success).toBe(true);
    if (missing.success) expect(missing.data.gender).toBeNull();

    const explicitNull = patientUpdateSchema.safeParse({ ...base, id: 'p1', gender: null });
    expect(explicitNull.success).toBe(true);
    if (explicitNull.success) expect(explicitNull.data.gender).toBeNull();
  });

  it('UPDATE still accepts and preserves a real gender', () => {
    const r = patientUpdateSchema.safeParse({ ...base, id: 'p1', gender: 'FEMALE' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.gender).toBe('FEMALE');
  });

  it('CREATE defaults confirmSharedPhone to false (warning fires on first submit)', () => {
    const r = patientCreateSchema.safeParse({ ...base, gender: 'MALE' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.confirmSharedPhone).toBe(false);
  });
});
