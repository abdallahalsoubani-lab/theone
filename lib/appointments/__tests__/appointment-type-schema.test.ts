import { describe, expect, it } from 'vitest';

import { appointmentCreateSchema } from '../schemas';

/**
 * July #8 — type-aware validation. SESSION requires ≥1 therapist; STRETCHING
 * is room-based with NO therapist. Room + patient are required for both.
 */
const base = {
  patientId: 'p1',
  roomId: 'r1',
  startsAt: new Date('2030-01-01T10:00:00Z'),
  durationMinutes: 30,
};

describe('appointmentCreateSchema — type-aware (July #8)', () => {
  it('SESSION still requires at least one therapist', () => {
    expect(appointmentCreateSchema.safeParse({ ...base, therapistIds: ['t1'] }).success).toBe(true);
    // No therapist → invalid for SESSION.
    expect(appointmentCreateSchema.safeParse({ ...base, therapistIds: [] }).success).toBe(false);
    // Default type is SESSION, so omitting therapists is also invalid.
    expect(appointmentCreateSchema.safeParse({ ...base }).success).toBe(false);
  });

  it('STRETCHING accepts a room + patient with NO therapist', () => {
    const r = appointmentCreateSchema.safeParse({
      ...base,
      appointmentType: 'STRETCHING',
      therapistIds: [],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.appointmentType).toBe('STRETCHING');
      expect(r.data.therapistIds).toEqual([]);
    }
    // Omitting therapistIds entirely (defaults to []) is also fine.
    expect(
      appointmentCreateSchema.safeParse({ ...base, appointmentType: 'STRETCHING' }).success,
    ).toBe(true);
  });

  it('STRETCHING REJECTS an attached therapist', () => {
    expect(
      appointmentCreateSchema.safeParse({
        ...base,
        appointmentType: 'STRETCHING',
        therapistIds: ['t1'],
      }).success,
    ).toBe(false);
  });

  it('a room is always required', () => {
    const { roomId: _omit, ...noRoom } = base;
    expect(
      appointmentCreateSchema.safeParse({
        ...noRoom,
        appointmentType: 'STRETCHING',
        therapistIds: [],
      }).success,
    ).toBe(false);
  });
});
