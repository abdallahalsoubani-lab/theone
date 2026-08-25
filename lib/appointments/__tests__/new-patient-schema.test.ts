import { describe, expect, it } from 'vitest';

import { newPatientBookingSchemaRefined } from '../schemas';

/**
 * P52 — the new-patient quick-add schema: English name + phone + adult/child
 * only (owner decision 1), and the same per-type therapist rule as the
 * single modal. EVENT/GROUP are not accepted as appointment types here.
 */
const base = (over: Record<string, unknown> = {}) => ({
  fullNameEn: 'Ahmad Ali',
  phone: '0790000000',
  formType: 'ADULT',
  appointmentType: 'SESSION',
  therapistIds: ['t1'],
  roomId: 'r1',
  startsAt: new Date('2030-05-10T08:00:00Z'),
  durationMinutes: 60,
  ...over,
});

const parse = (input: unknown) => newPatientBookingSchemaRefined.safeParse(input);

describe('newPatientBookingSchema', () => {
  it('accepts a minimal adult SESSION booking (name + phone + type + slot)', () => {
    expect(parse(base()).success).toBe(true);
  });

  it('requires an English name (min 2)', () => {
    expect(parse(base({ fullNameEn: 'A' })).success).toBe(false);
    expect(parse(base({ fullNameEn: '' })).success).toBe(false);
  });

  it('requires a phone', () => {
    expect(parse(base({ phone: '' })).success).toBe(false);
  });

  it('requires a room', () => {
    expect(parse(base({ roomId: '' })).success).toBe(false);
  });

  it('SESSION needs ≥1 therapist; STRETCHING needs zero', () => {
    expect(parse(base({ appointmentType: 'SESSION', therapistIds: [] })).success).toBe(false);
    expect(parse(base({ appointmentType: 'STRETCHING', therapistIds: ['t1'] })).success).toBe(
      false,
    );
    expect(parse(base({ appointmentType: 'STRETCHING', therapistIds: [] })).success).toBe(true);
  });

  it('rejects EVENT and GROUP appointment types (single-modal only)', () => {
    expect(parse(base({ appointmentType: 'EVENT' })).success).toBe(false);
    expect(parse(base({ appointmentType: 'GROUP' })).success).toBe(false);
  });

  it('only ADULT / PEDIATRIC form types are valid', () => {
    expect(parse(base({ formType: 'ADULT' })).success).toBe(true);
    expect(parse(base({ formType: 'PEDIATRIC' })).success).toBe(true);
    expect(parse(base({ formType: 'TEEN' })).success).toBe(false);
  });
});
