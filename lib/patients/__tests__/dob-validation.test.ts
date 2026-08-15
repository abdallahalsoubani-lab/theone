import { describe, expect, it } from 'vitest';

import { publicProfileSchema } from '@/lib/intake-submissions/schemas';

import { patientCreateSchema } from '../schemas';

/**
 * Prompt 46 item A — DOB is picked from a calendar but must stay bounded and
 * ISO at rest: no future dates, 1900 floor (inclusive — 1900-01-01 is also
 * the P52 "unknown DOB" sentinel and must keep round-tripping), and the form
 * string value coerces to the same instant.
 */

const validPatient = {
  fullNameEn: 'Test Patient',
  phone: '+962791234567',
  gender: 'MALE',
  languagePref: 'AR',
};

function parseDob(dateOfBirth: string) {
  return patientCreateSchema.safeParse({ ...validPatient, dateOfBirth });
}

describe('patientCreateSchema.dateOfBirth', () => {
  it('accepts a normal birth date and coerces the ISO string to that date', () => {
    const r = parseDob('1985-06-15');
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dateOfBirth.toISOString().slice(0, 10)).toBe('1985-06-15');
    }
  });

  it('rejects a future date with the dobFuture token', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = parseDob(future);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === 'dobFuture')).toBe(true);
    }
  });

  it('rejects a pre-1900 date with the dobTooEarly token', () => {
    const r = parseDob('1899-12-31');
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message === 'dobTooEarly')).toBe(true);
    }
  });

  it('keeps accepting the P52 unknown-DOB sentinel (1900-01-01) so imported patients round-trip', () => {
    expect(parseDob('1900-01-01').success).toBe(true);
  });

  it('round-trips an existing patient DOB unchanged (edit path)', () => {
    const stored = new Date('1972-03-09T00:00:00.000Z');
    const r = parseDob(stored.toISOString().slice(0, 10));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dateOfBirth.toISOString().slice(0, 10)).toBe('1972-03-09');
    }
  });
});

describe('publicProfileSchema.dateOfBirth (public form — same bounds)', () => {
  const base = {
    fullNameEn: 'Test Patient',
    phone: '0791234567',
    gender: 'FEMALE',
  };

  it('accepts a valid ISO date string', () => {
    const r = publicProfileSchema.safeParse({ ...base, dateOfBirth: '1990-01-20' });
    expect(r.success).toBe(true);
  });

  it('rejects future and pre-1900 dates with the same tokens', () => {
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rFuture = publicProfileSchema.safeParse({ ...base, dateOfBirth: future });
    expect(rFuture.success).toBe(false);
    const rEarly = publicProfileSchema.safeParse({ ...base, dateOfBirth: '1899-06-01' });
    expect(rEarly.success).toBe(false);
  });
});
