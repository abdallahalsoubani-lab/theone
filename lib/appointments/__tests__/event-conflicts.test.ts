import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July #8 part 2 — an EVENT makes its therapists busy (so it blocks overlapping
 * SESSIONs and vice-versa, via the existing therapist-overlap path) and, if it
 * holds a room, blocks that room for any other booking.
 */

const startsAt = new Date('2030-01-05T10:00:00Z');
const overlappingAppt = (extra: Record<string, unknown>) => ({
  id: 'other-1',
  startsAt,
  durationMinutes: 60,
  status: 'CONFIRMED',
  patient: null,
  appointmentType: 'EVENT',
  title: 'Staff meeting',
  therapists: [],
  ...extra,
});

const state = {
  therapistOverlaps: [] as Record<string, unknown>[],
  roomEvents: [] as Record<string, unknown>[],
};

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn(async () => [{ id: 't1', fullNameEn: 'Ahmad', fullNameAr: 'أحمد' }]) },
    leave: { findMany: vi.fn(async () => []) },
    room: { findUnique: vi.fn(async () => ({ name: 'Room 1', bedCount: 4 })) },
    appointment: {
      findMany: vi.fn(
        async ({ where }: { where: { appointmentType?: string; therapists?: unknown } }) => {
          if (where.appointmentType === 'EVENT') return state.roomEvents;
          if (where.appointmentType === 'STRETCHING') return [];
          if (where.therapists) return state.therapistOverlaps;
          return []; // patient scope
        },
      ),
    },
  },
}));

import { checkConflicts, hasHardBlockedConflict } from '../conflicts';

const noHours = { hours: { hours: null, timeZone: 'Asia/Amman' } };

beforeEach(() => {
  state.therapistOverlaps = [];
  state.roomEvents = [];
});

describe('EVENT participates in therapist-busy detection', () => {
  it('blocks a SESSION for a therapist who has an overlapping EVENT', async () => {
    state.therapistOverlaps = [overlappingAppt({})]; // the EVENT covering Ahmad
    const r = await checkConflicts(
      {
        patientId: 'p1',
        therapistIds: ['t1'],
        startsAt,
        durationMinutes: 30,
        appointmentType: 'SESSION',
        roomId: null,
      },
      noHours,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const overlap = r.conflicts.find((c) => c.kind === 'THERAPIST_OVERLAP');
      expect(overlap).toBeDefined();
    }
  });

  it('a patient-less EVENT runs no patient-overlap check (patientId null)', async () => {
    // No therapist overlaps, no room → an EVENT with just therapists is clean.
    const r = await checkConflicts(
      {
        patientId: null,
        therapistIds: ['t1'],
        startsAt,
        durationMinutes: 30,
        appointmentType: 'EVENT',
        roomId: null,
      },
      noHours,
    );
    expect(r.ok).toBe(true);
  });
});

describe('a room-holding EVENT blocks the room', () => {
  it('blocks a SESSION booked into a room an EVENT holds (hard block)', async () => {
    state.roomEvents = [overlappingAppt({ title: 'Room 1 maintenance' })];
    const r = await checkConflicts(
      {
        patientId: 'p1',
        therapistIds: ['t1'],
        startsAt,
        durationMinutes: 30,
        appointmentType: 'SESSION',
        roomId: 'r1',
      },
      noHours,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.conflicts.some((c) => c.kind === 'ROOM_BLOCKED_BY_EVENT')).toBe(true);
      expect(hasHardBlockedConflict(r.conflicts)).toBe(true);
    }
  });

  it('blocks a STRETCHING booking in the same room too', async () => {
    state.roomEvents = [overlappingAppt({ title: 'Maintenance' })];
    const r = await checkConflicts(
      {
        patientId: 'p1',
        therapistIds: [],
        startsAt,
        durationMinutes: 30,
        appointmentType: 'STRETCHING',
        roomId: 'r1',
      },
      noHours,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflicts.some((c) => c.kind === 'ROOM_BLOCKED_BY_EVENT')).toBe(true);
  });
});
