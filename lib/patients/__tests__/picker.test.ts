import { describe, expect, it } from 'vitest';

import { patientPickerOption } from '../picker';
import { filterPickerOptions } from '@/lib/pickers/filter';

/**
 * P52 follow-up incident — the booking-modal picker could not find patients
 * the patients list finds. The shared builder + the uncapped brief list are
 * the fix; these tests pin the search semantics for every picker surface.
 */

const arOnly = { id: 'imp-c-001', fullNameEn: '', fullNameAr: 'طفل مستورد', phone: null };
const both = {
  id: 'p-new',
  fullNameEn: 'Abdallah Alsoubani',
  fullNameAr: 'عبدالله الصوباني',
  phone: '+962790000001',
};

describe('patientPickerOption — bidirectional labels (P50)', () => {
  it('an ARABIC-ONLY imported patient never renders a blank label — in either locale', () => {
    expect(patientPickerOption(arOnly, 'ar').label).toBe('طفل مستورد');
    expect(patientPickerOption(arOnly, 'en').label).toBe('طفل مستورد');
  });

  it('phone is appended only when provided (P15 — callers null it out when hidden)', () => {
    expect(patientPickerOption(both, 'ar').label).toBe('عبدالله الصوباني (+962790000001)');
    expect(patientPickerOption({ ...both, phone: null }, 'ar').label).toBe('عبدالله الصوباني');
  });

  it('sublabel carries the other script only when it differs', () => {
    expect(patientPickerOption(both, 'ar').sublabel).toBe('Abdallah Alsoubani');
    expect(patientPickerOption(arOnly, 'en').sublabel).toBeNull();
  });
});

describe('picker search — the live reproduction', () => {
  const options = [arOnly, both].map((p) => patientPickerOption(p, 'ar'));

  it('"عبدالله الصو" finds the patient the patients-list finds', () => {
    expect(filterPickerOptions(options, 'عبدالله الصو').map((o) => o.id)).toEqual(['p-new']);
  });

  it('the ENGLISH name finds the same patient in the Arabic UI (sublabel searched)', () => {
    expect(filterPickerOptions(options, 'alsoubani').map((o) => o.id)).toEqual(['p-new']);
  });

  it('an Arabic-only imported patient is findable in the English UI', () => {
    const en = [arOnly, both].map((p) => patientPickerOption(p, 'en'));
    expect(filterPickerOptions(en, 'مستورد').map((o) => o.id)).toEqual(['imp-c-001']);
  });
});
