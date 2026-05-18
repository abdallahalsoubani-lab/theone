import { CancellationCategory } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { appointmentCancelSchema } from '../schemas';

const validId = 'cl' + 'a'.repeat(23);

describe('appointmentCancelSchema', () => {
  it('accepts a full payload with every defined category', () => {
    for (const category of Object.values(CancellationCategory)) {
      const r = appointmentCancelSchema.safeParse({
        id: validId,
        cancellationCategory: category,
        cancellationReason: 'short reason',
        cancellationNotes: 'optional context',
        notifyPatient: true,
      });
      expect(r.success).toBe(true);
    }
  });

  it('rejects payloads missing the category (Prompt 7b §4.2 — picker is required)', () => {
    const r = appointmentCancelSchema.safeParse({
      id: validId,
      cancellationReason: 'short reason',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown category values', () => {
    const r = appointmentCancelSchema.safeParse({
      id: validId,
      cancellationCategory: 'BOGUS_CATEGORY',
      cancellationReason: 'short reason',
    });
    expect(r.success).toBe(false);
  });

  it('defaults notifyPatient to true when omitted', () => {
    const r = appointmentCancelSchema.parse({
      id: validId,
      cancellationCategory: CancellationCategory.PATIENT_REQUEST,
      cancellationReason: 'patient request',
    });
    expect(r.notifyPatient).toBe(true);
  });

  it('respects notifyPatient: false (Secretary opt-out)', () => {
    const r = appointmentCancelSchema.parse({
      id: validId,
      cancellationCategory: CancellationCategory.CLINIC_RESCHEDULING,
      cancellationReason: 'clinic rescheduling',
      notifyPatient: false,
    });
    expect(r.notifyPatient).toBe(false);
  });

  it('allows cancellationNotes to be omitted or null', () => {
    const without = appointmentCancelSchema.parse({
      id: validId,
      cancellationCategory: CancellationCategory.OTHER,
      cancellationReason: 'other',
    });
    expect(without.cancellationNotes).toBeUndefined();

    const nulled = appointmentCancelSchema.parse({
      id: validId,
      cancellationCategory: CancellationCategory.OTHER,
      cancellationReason: 'other',
      cancellationNotes: null,
    });
    expect(nulled.cancellationNotes).toBeNull();
  });

  it('caps cancellationNotes at 500 characters', () => {
    const r = appointmentCancelSchema.safeParse({
      id: validId,
      cancellationCategory: CancellationCategory.OTHER,
      cancellationReason: 'other',
      cancellationNotes: 'x'.repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it('includes all 9 Prompt 7b categories in the enum', () => {
    const expected = [
      'PATIENT_REQUEST',
      'PATIENT_NO_SHOW',
      'PATIENT_ILLNESS',
      'PATIENT_TRAVEL',
      'CLINIC_RESCHEDULING',
      'THERAPIST_UNAVAILABLE',
      'WEATHER',
      'INSURANCE_ISSUE',
      'OTHER',
    ];
    expect(Object.values(CancellationCategory).sort()).toEqual(expected.sort());
  });
});
