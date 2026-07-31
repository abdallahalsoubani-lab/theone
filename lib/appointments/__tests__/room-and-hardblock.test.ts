import { describe, expect, it, vi } from 'vitest';

// conflicts.ts pulls in @/lib/db (→ env). The helpers under test are pure, so a
// stub db is enough to import the module without a real Prisma client / env.
vi.mock('@/lib/db', () => ({ db: {} }));

import { hasHardBlockedConflict, isHardBlockedConflict, type Conflict } from '../conflicts';
import { appointmentCreateSchema, batchRowSchema } from '../schemas';

const baseCreate = {
  patientId: 'p1',
  therapistIds: ['t1'],
  startsAt: new Date('2030-01-01T10:00:00Z'),
  durationMinutes: 30,
};

describe('appointment room requirement (QA retest #7/#13)', () => {
  it('rejects a create with no / empty / null roomId', () => {
    expect(appointmentCreateSchema.safeParse({ ...baseCreate }).success).toBe(false);
    expect(appointmentCreateSchema.safeParse({ ...baseCreate, roomId: '' }).success).toBe(false);
    expect(appointmentCreateSchema.safeParse({ ...baseCreate, roomId: null }).success).toBe(false);
  });

  it('accepts a create with a roomId', () => {
    expect(appointmentCreateSchema.safeParse({ ...baseCreate, roomId: 'r1' }).success).toBe(true);
  });

  it('requires roomId for every batch row too (July 31 item 4)', () => {
    const row = {
      startsAt: new Date('2030-01-01T10:00:00Z'),
      durationMinutes: 30,
      therapistIds: ['t1'],
    };
    expect(batchRowSchema.safeParse(row).success).toBe(false);
    expect(batchRowSchema.safeParse({ ...row, roomId: 'r1' }).success).toBe(true);
  });
});

describe('hard-blocked conflict kinds (QA retest #15 + Prompt 22 §4.1/§4.2)', () => {
  const patientOverlap = { kind: 'PATIENT_OVERLAP', appointment: {} } as unknown as Conflict;
  const therapistOverlap = {
    kind: 'THERAPIST_OVERLAP',
    therapist: {},
    appointment: {},
  } as unknown as Conflict;
  const outsideHours = {
    kind: 'OUTSIDE_BUSINESS_HOURS',
    reason: 'before_open',
    openTime: '08:00',
    closeTime: '18:00',
    dayKey: 'MON',
  } as unknown as Conflict;

  const clinicClosed = { kind: 'CLINIC_CLOSED_THIS_DAY', dayKey: 'fri' } as unknown as Conflict;

  it('treats PATIENT_OVERLAP and CLINIC_CLOSED_THIS_DAY as hard-blocked', () => {
    expect(isHardBlockedConflict(patientOverlap)).toBe(true);
    expect(isHardBlockedConflict(clinicClosed)).toBe(true);
    expect(isHardBlockedConflict(therapistOverlap)).toBe(false);
    expect(isHardBlockedConflict(outsideHours)).toBe(false);
  });

  it('detects a hard block within a mixed conflict set', () => {
    expect(hasHardBlockedConflict([therapistOverlap, outsideHours])).toBe(false);
    expect(hasHardBlockedConflict([therapistOverlap, patientOverlap])).toBe(true);
    expect(hasHardBlockedConflict([therapistOverlap, clinicClosed])).toBe(true);
  });
});
