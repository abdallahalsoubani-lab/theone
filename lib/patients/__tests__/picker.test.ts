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

// P47 row 8 — English-only labels (updates the P50 bidirectional
// expectations): the label is the English display name in both locales; the
// Arabic name is no longer RENDERED but stays SEARCHABLE via hidden
// searchTerms (match yes, display no — the kiosk asymmetry generalized).
describe('patientPickerOption — English-only labels (P47 row 8)', () => {
  it('an ARABIC-ONLY legacy patient never renders a blank label — fallback in either locale', () => {
    expect(patientPickerOption(arOnly, 'ar').label).toBe('طفل مستورد');
    expect(patientPickerOption(arOnly, 'en').label).toBe('طفل مستورد');
  });

  it('phone is appended only when provided (P15 — callers null it out when hidden)', () => {
    expect(patientPickerOption(both, 'ar').label).toBe('Abdallah Alsoubani (+962790000001)');
    expect(patientPickerOption({ ...both, phone: null }, 'ar').label).toBe('Abdallah Alsoubani');
  });

  it('no sublabel anymore; the Arabic name rides in the hidden searchTerms', () => {
    expect(patientPickerOption(both, 'ar').sublabel).toBeNull();
    expect(patientPickerOption(both, 'ar').searchTerms).toEqual(['عبدالله الصوباني']);
    expect(patientPickerOption(arOnly, 'en').sublabel).toBeNull();
  });
});

describe('picker search — the live reproduction', () => {
  const options = [arOnly, both].map((p) => patientPickerOption(p, 'ar'));

  it('"عبدالله الصو" finds the patient the patients-list finds', () => {
    expect(filterPickerOptions(options, 'عبدالله الصو').map((o) => o.id)).toEqual(['p-new']);
  });

  it('the ENGLISH name finds the same patient in the Arabic UI (label searched)', () => {
    expect(filterPickerOptions(options, 'alsoubani').map((o) => o.id)).toEqual(['p-new']);
  });

  it('an Arabic-only imported patient is findable in the English UI', () => {
    const en = [arOnly, both].map((p) => patientPickerOption(p, 'en'));
    expect(filterPickerOptions(en, 'مستورد').map((o) => o.id)).toEqual(['imp-c-001']);
  });
});
