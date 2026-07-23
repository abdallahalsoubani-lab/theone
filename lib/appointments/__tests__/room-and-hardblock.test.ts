import { describe, expect, it, vi } from 'vitest';

// conflicts.ts pulls in @/lib/db (→ env). The helpers under test are pure, so a
// stub db is enough to import the module without a real Prisma client / env.
vi.mock('@/lib/db', () => ({ db: {} }));

import { hasHardBlockedConflict, isHardBlockedConflict, type Conflict } from '../conflicts';
import { appointmentCreateSchema, seriesPreviewSchema } from '../schemas';

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

  it('requires roomId for a recurring series too', () => {
    const series = {
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date('2030-01-01T10:00:00Z'),
      durationMinutes: 30,
      rule: { frequency: 'WEEKLY' as const, interval: 1, byWeekday: ['MON' as const], count: 4 },
    };
    expect(seriesPreviewSchema.safeParse(series).success).toBe(false);
    expect(seriesPreviewSchema.safeParse({ ...series, roomId: 'r1' }).success).toBe(true);
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

describe('recurring day rules (P22 cap removed by Prompt 46; R-6 days ≤ count stays)', () => {
  const series = (byWeekday: string[], count = 4) => ({
    patientId: 'p1',
    therapistIds: ['t1'],
    startsAt: new Date('2030-01-01T10:00:00Z'),
    durationMinutes: 30,
    roomId: 'r1',
    rule: { frequency: 'WEEKLY' as const, interval: 1, byWeekday, count },
  });

  it('accepts any number of weekdays up to the appointment count (no fixed 2-day cap)', () => {
    expect(seriesPreviewSchema.safeParse(series(['MON'])).success).toBe(true);
    expect(seriesPreviewSchema.safeParse(series(['MON', 'WED'])).success).toBe(true);
    // 3 and 4 days were rejected under the old P22 cap — now fine when count allows.
    expect(seriesPreviewSchema.safeParse(series(['MON', 'WED', 'THU'])).success).toBe(true);
    expect(seriesPreviewSchema.safeParse(series(['SUN', 'MON', 'TUE', 'WED'])).success).toBe(true);
    expect(
      seriesPreviewSchema.safeParse(series(['SUN', 'MON', 'TUE', 'WED', 'THU'], 6)).success,
    ).toBe(true);
    expect(seriesPreviewSchema.safeParse(series([])).success).toBe(false);
  });

  it('R-6 still binds: 3 selected days with count=2 is rejected', () => {
    expect(seriesPreviewSchema.safeParse(series(['MON', 'WED', 'THU'], 2)).success).toBe(false);
  });

  it('R-6 (Prompt 42): rejects more weekdays than appointments — days ≤ count', () => {
    const two = series(['MON', 'WED']);
    const withCount = (count: number) => ({ ...two, rule: { ...two.rule, count } });
    // 2 days over a 1-appointment series is a crafted request — rejected.
    expect(seriesPreviewSchema.safeParse(withCount(1)).success).toBe(false);
    // days == count and days < count are both fine.
    expect(seriesPreviewSchema.safeParse(withCount(2)).success).toBe(true);
    expect(seriesPreviewSchema.safeParse(withCount(3)).success).toBe(true);
  });
});
