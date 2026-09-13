import { describe, expect, it } from 'vitest';

import { getAppointmentTherapistLabel } from '../therapistLabel';

const th = (fullNameEn: string, fullNameAr: string) => ({ therapist: { fullNameEn, fullNameAr } });
const LINA = th('Dr. Lina', 'د. لينا');
const RANA = th('Rana Adeeb', 'رنا أديب');

/**
 * P61 §1.3.3 — the clinician label. These assertions are the contract that
 * this prompt changed NOTHING about what goes out: only where the rule lives.
 */
describe('getAppointmentTherapistLabel', () => {
  it('one therapist → the name in the recipient language', () => {
    expect(getAppointmentTherapistLabel({ therapists: [LINA], language: 'AR' })).toBe('د. لينا');
    expect(getAppointmentTherapistLabel({ therapists: [LINA], language: 'EN' })).toBe('Dr. Lina');
  });

  it('two therapists → the FIRST assigned one, identical to the single-therapist output', () => {
    expect(getAppointmentTherapistLabel({ therapists: [LINA, RANA], language: 'AR' })).toBe(
      getAppointmentTherapistLabel({ therapists: [LINA], language: 'AR' }),
    );
    expect(getAppointmentTherapistLabel({ therapists: [LINA, RANA], language: 'EN' })).toBe(
      'Dr. Lina',
    );
  });

  it('zero therapists → the clinic fallback, never an empty parameter', () => {
    expect(getAppointmentTherapistLabel({ therapists: [], language: 'AR' })).toBe('فريق العيادة');
    expect(getAppointmentTherapistLabel({ therapists: [], language: 'EN' })).toBe(
      'the clinic team',
    );
  });

  it('zero therapists on a STRETCHING booking → its own wording when the caller asks for it', () => {
    expect(
      getAppointmentTherapistLabel({
        therapists: [],
        language: 'AR',
        appointmentType: 'STRETCHING',
      }),
    ).toBe('جلسة استطالة');
    expect(
      getAppointmentTherapistLabel({
        therapists: [],
        language: 'EN',
        appointmentType: 'STRETCHING',
      }),
    ).toBe('Stretching session');
  });

  it('never returns an empty string for any combination', () => {
    for (const language of ['AR', 'EN'] as const) {
      for (const therapists of [[], [LINA], [LINA, RANA]]) {
        for (const appointmentType of [undefined, 'SESSION', 'STRETCHING', 'GROUP']) {
          expect(
            getAppointmentTherapistLabel({ therapists, language, appointmentType }).length,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});
