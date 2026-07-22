import { describe, expect, it } from 'vitest';

import { buildClinicianSummaryCsv } from '../csv';

const summary = {
  rows: [
    {
      clinicianId: 't1',
      fullNameEn: 'Ahmad Mansour',
      fullNameAr: 'أحمد منصور',
      role: 'THERAPIST' as const,
      completed: 3,
      booked: 5,
      cancelled: 1,
      noShow: 1,
    },
  ],
  totals: { completed: 3, booked: 5, cancelled: 1, noShow: 1 },
};

const AR_LABELS = {
  clinician: 'الأخصائي',
  role: 'الدور',
  completed: 'مكتملة',
  booked: 'محجوزة',
  cancelled: 'ملغاة',
  noShow: 'لم يحضر',
  totalsRow: 'الإجمالي',
};

describe('buildClinicianSummaryCsv (Prompt 40 §3.4)', () => {
  it('emits localized headers, per-row counts, and a totals row', () => {
    const csv = buildClinicianSummaryCsv(summary, AR_LABELS, 'ar');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('الأخصائي,الدور,مكتملة,محجوزة,ملغاة,لم يحضر');
    expect(lines[1]).toBe('أحمد منصور,THERAPIST,3,5,1,1');
    expect(lines[2]).toBe('الإجمالي,,3,5,1,1');
  });

  it('uses the English name in the EN locale and escapes commas/quotes', () => {
    const withComma = {
      ...summary,
      rows: [{ ...summary.rows[0]!, fullNameEn: 'Mansour, Ahmad "Abu Ali"' }],
    };
    const csv = buildClinicianSummaryCsv(withComma, { ...AR_LABELS, clinician: 'Clinician' }, 'en');
    expect(csv.split('\n')[1]).toContain('"Mansour, Ahmad ""Abu Ali"""');
  });
});
