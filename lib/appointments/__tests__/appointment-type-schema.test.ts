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

  it('a room is required for SESSION + STRETCHING', () => {
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

describe('appointmentCreateSchema — EVENT (July #8 part 2)', () => {
  const { patientId: _p, ...noPatient } = base;

  it('accepts an EVENT with a title, no patient, and optional room/therapists', () => {
    // Title only (no room, no therapist) is valid.
    const { roomId: _r, ...noRoom } = noPatient;
    const r = appointmentCreateSchema.safeParse({
      ...noRoom,
      appointmentType: 'EVENT',
      title: 'Staff meeting',
      therapistIds: [],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.appointmentType).toBe('EVENT');
      expect(r.data.title).toBe('Staff meeting');
    }
    // With therapists + a room is also valid.
    expect(
      appointmentCreateSchema.safeParse({
        ...noPatient,
        appointmentType: 'EVENT',
        title: 'Training',
        therapistIds: ['t1', 't2'],
      }).success,
    ).toBe(true);
  });

  it('REQUIRES a title', () => {
    expect(
      appointmentCreateSchema.safeParse({
        ...noPatient,
        appointmentType: 'EVENT',
        therapistIds: [],
      }).success,
    ).toBe(false);
  });

  it('FORBIDS a patient', () => {
    expect(
      appointmentCreateSchema.safeParse({
        ...base,
        appointmentType: 'EVENT',
        title: 'Meeting',
        therapistIds: [],
      }).success,
    ).toBe(false);
  });
});

describe('appointmentCreateSchema — GROUP (July #8 part 3)', () => {
  const { patientId: _p, roomId: _r, ...noPatientNoRoom } = base;

  it('accepts a GROUP with several patients + ≥1 therapist (room optional)', () => {
    const r = appointmentCreateSchema.safeParse({
      ...noPatientNoRoom,
      appointmentType: 'GROUP',
      patientIds: ['p1', 'p2', 'p3'],
      therapistIds: ['t1'],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.appointmentType).toBe('GROUP');
      expect(r.data.patientIds).toEqual(['p1', 'p2', 'p3']);
    }
    // An optional workshop label + a room are both allowed.
    expect(
      appointmentCreateSchema.safeParse({
        ...noPatientNoRoom,
        roomId: 'r1',
        appointmentType: 'GROUP',
        title: 'Back-care workshop',
        patientIds: ['p1', 'p2'],
        therapistIds: ['t1', 't2'],
      }).success,
    ).toBe(true);
  });

  it('REQUIRES at least one patient', () => {
    expect(
      appointmentCreateSchema.safeParse({
        ...noPatientNoRoom,
        appointmentType: 'GROUP',
        patientIds: [],
        therapistIds: ['t1'],
      }).success,
    ).toBe(false);
  });

  it('REQUIRES at least one therapist', () => {
    expect(
      appointmentCreateSchema.safeParse({
        ...noPatientNoRoom,
        appointmentType: 'GROUP',
        patientIds: ['p1'],
        therapistIds: [],
      }).success,
    ).toBe(false);
  });

  it('FORBIDS the single scalar patientId (members live in the set)', () => {
    expect(
      appointmentCreateSchema.safeParse({
        ...noPatientNoRoom,
        patientId: 'p1',
        appointmentType: 'GROUP',
        patientIds: ['p1', 'p2'],
        therapistIds: ['t1'],
      }).success,
    ).toBe(false);
  });

  it('non-GROUP types REJECT a patient set', () => {
    // SESSION with patientIds populated is invalid.
    expect(
      appointmentCreateSchema.safeParse({
        ...base,
        therapistIds: ['t1'],
        patientIds: ['p2', 'p3'],
      }).success,
    ).toBe(false);
    // A plain SESSION with no patientIds still parses (regression).
    expect(appointmentCreateSchema.safeParse({ ...base, therapistIds: ['t1'] }).success).toBe(true);
  });
});
