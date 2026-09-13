import { describe, expect, it } from 'vitest';

import { formatPatientPhone, normalizePhoneForStorage, phoneSearchSuffix } from '../phone';
import { isValidPhone, normalizePhoneStrict, parsePhone } from '../phone-validate';

/**
 * P61 item 2 §2.4 — international numbers are accepted while the bare local
 * shape the secretary types keeps working untouched.
 */
describe('normalizePhoneStrict — Jordan stays the default country', () => {
  it('every accepted Jordanian shape collapses to the same canonical value', () => {
    for (const input of [
      '0790123456',
      '+962790123456',
      '00962790123456',
      '962790123456',
      '079 012 3456',
      '+962-79-012-3456',
      '٠٧٩٠١٢٣٤٥٦', // Arabic-Indic digits — the clinic types in Arabic
      '۰۷۹۰۱۲۳۴۵۶', // Persian digits
    ]) {
      expect(normalizePhoneStrict(input)).toBe('+962790123456');
    }
  });

  it('the cheap client-side normaliser agrees on the canonical shape', () => {
    for (const input of ['0790123456', '+962790123456', '٠٧٩٠١٢٣٤٥٦']) {
      expect(normalizePhoneForStorage(input)).toBe('+962790123456');
    }
  });
});

describe('normalizePhoneStrict — foreign numbers', () => {
  it('accepts a valid US number in the shapes people paste', () => {
    expect(normalizePhoneStrict('+1 (415) 555-2671')).toBe('+14155552671');
    expect(normalizePhoneStrict('+14155552671')).toBe('+14155552671');
    expect(normalizePhoneStrict('001 415 555 2671')).toBe('+14155552671');
  });

  it('accepts Gulf numbers', () => {
    expect(normalizePhoneStrict('+971 50 123 4567')).toBe('+971501234567');
    expect(normalizePhoneStrict('+966 50 123 4567')).toBe('+966501234567');
  });

  it('rejects a too-short US number', () => {
    expect(normalizePhoneStrict('+1 415 555')).toBeNull();
    expect(isValidPhone('+1 415 555')).toBe(false);
  });

  it('rejects a nonexistent country code — validity is per country, not per length', () => {
    expect(normalizePhoneStrict('+999123456789')).toBeNull();
  });

  it('rejects letters and empty input', () => {
    expect(normalizePhoneStrict('not a phone')).toBeNull();
    expect(normalizePhoneStrict('')).toBeNull();
  });

  it('reports the resolved country', () => {
    expect(parsePhone('+14155552671').country).toBe('US');
    expect(parsePhone('0790123456').country).toBe('JO');
  });
});

describe('the same number in two shapes is one number', () => {
  it('two patients entered differently normalise to the same stored value', () => {
    const a = normalizePhoneStrict('0790123456');
    const b = normalizePhoneStrict('+962 79 012 3456');
    expect(a).toBe(b);
  });

  it('phone search matches whichever shape was typed', () => {
    const stored = '+962790123456';
    for (const typed of ['0790123456', '+962790123456', '00962790123456', '٠٧٩٠١٢٣٤٥٦']) {
      const suffix = phoneSearchSuffix(typed);
      expect(suffix).not.toBeNull();
      expect(stored.endsWith(suffix!)).toBe(true);
    }
  });

  it('a foreign number is searchable by its last 8 digits too', () => {
    expect('+14155552671'.endsWith(phoneSearchSuffix('415-555-2671')!)).toBe(true);
  });
});

describe('formatPatientPhone', () => {
  it('keeps the familiar Jordanian grouping', () => {
    expect(formatPatientPhone('+962790123456')).toContain('+962 79 012 3456');
    expect(formatPatientPhone('0790123456')).toContain('+962 79 012 3456');
  });

  it('groups a foreign number instead of dumping it raw', () => {
    expect(formatPatientPhone('+14155552671')).toContain('+1 415 555 2671');
    expect(formatPatientPhone('+971501234567')).toContain('+971 501 234 567');
  });

  it('renders the shared placeholder for a missing phone (P50)', () => {
    expect(formatPatientPhone(null)).toBe('—');
    expect(formatPatientPhone('')).toBe('—');
  });

  it('never throws on junk — it renders what it was given', () => {
    expect(formatPatientPhone('not a phone')).toContain('not a phone');
  });
});

describe('WhatsApp send address', () => {
  it('builds whatsapp:+E.164 for a foreign number with no 962 assumption', () => {
    const stored = normalizePhoneStrict('+1 (415) 555-2671')!;
    expect(`whatsapp:${stored}`).toBe('whatsapp:+14155552671');
    expect(stored.startsWith('+')).toBe(true);
    expect(/\s|\(|\)|-/.test(stored)).toBe(false);
  });
});

/**
 * P61 — the emergency contact shares the canonical shape but not the
 * country-level parser (it is never a WhatsApp recipient). Pinned here so the
 * field the country selector was added to cannot regress to Jordan-only.
 */
describe('patient schema — phone fields accept international input', () => {
  it('the messaged phone and the emergency contact both take a US number', async () => {
    const { patientCreateSchema } = await import('@/lib/patients/schemas');
    const base = {
      fullNameEn: 'Sara Khalil',
      dateOfBirth: '1990-01-01',
      gender: 'FEMALE',
      languagePref: 'AR',
    };
    const r = patientCreateSchema.safeParse({
      ...base,
      phone: '+1 (415) 555-2671',
      emergencyContactPhone: '+1 415 555 2672',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.phone).toBe('+14155552671');
    expect(r.data.emergencyContactPhone).toBe('+14155552672');
  });

  it('a bare Jordanian number still normalises exactly as before', () => {
    expect(normalizePhoneForStorage('0790123456')).toBe('+962790123456');
  });
});
