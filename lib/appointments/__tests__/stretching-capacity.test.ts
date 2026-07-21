import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July #8 — STRETCHING is capacity-limited by the room's bed count. As many
 * concurrent stretching appointments as beds are allowed; one more is blocked
 * (ROOM_AT_CAPACITY, hard-blocked). SESSION never triggers a room check.
 */

interface StretchRow {
  startsAt: Date;
  durationMinutes: number;
}
const state = {
  bedCount: 4,
  roomName: 'Room A',
  stretchOverlaps: [] as StretchRow[],
};

vi.mock('@/lib/db', () => ({
  db: {
    user: { findMany: vi.fn(async () => []) }, // no therapists on stretching
    leave: { findMany: vi.fn(async () => []) },
    room: {
      findUnique: vi.fn(async () => ({ name: state.roomName, bedCount: state.bedCount })),
    },
    appointment: {
      findMany: vi.fn(async ({ where }: { where: { appointmentType?: string } }) => {
        // The stretching-capacity count query filters by appointmentType; the
        // patient-overlap query does not (return no patient clashes here).
        if (where.appointmentType === 'STRETCHING') return state.stretchOverlaps;
        return [];
      }),
    },
  },
}));

import { checkConflicts, hasHardBlockedConflict, isHardBlockedConflict } from '../conflicts';

// Business hours are provided inline (null → skip the hours DB + always OK).
const noHours = { hours: { hours: null, timeZone: 'Asia/Amman' } };
const startsAt = new Date('2030-01-05T10:00:00Z');
const stretch = (mins: number): StretchRow => ({ startsAt, durationMinutes: mins });

beforeEach(() => {
  state.bedCount = 4;
  state.stretchOverlaps = [];
});

describe('STRETCHING bed capacity', () => {
  it('allows a booking when free beds remain (3 used of 4)', async () => {
    state.stretchOverlaps = [stretch(30), stretch(30), stretch(30)];
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
    expect(r.ok).toBe(true);
  });

  it('blocks the booking that would exceed capacity (4 used of 4)', async () => {
    state.stretchOverlaps = [stretch(30), stretch(30), stretch(30), stretch(30)];
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
    if (!r.ok) {
      const cap = r.conflicts.find((c) => c.kind === 'ROOM_AT_CAPACITY');
      expect(cap).toBeDefined();
      // Capacity is a hard block — never overridable.
      expect(hasHardBlockedConflict(r.conflicts)).toBe(true);
      if (cap) expect(isHardBlockedConflict(cap)).toBe(true);
    }
  });

  it('cancelling one frees a slot (3 used → allowed again)', async () => {
    state.stretchOverlaps = [stretch(30), stretch(30), stretch(30)]; // one was cancelled
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
    expect(r.ok).toBe(true);
  });

  it('SESSION never runs the room capacity check (regression)', async () => {
    // Even with the room "full", a SESSION (default) ignores bed capacity.
    state.stretchOverlaps = [stretch(30), stretch(30), stretch(30), stretch(30)];
    const r = await checkConflicts(
      {
        patientId: 'p1',
        therapistIds: [],
        startsAt,
        durationMinutes: 30,
        appointmentType: 'SESSION',
        roomId: 'r1',
      },
      noHours,
    );
    expect(r.ok).toBe(true);
  });
});
