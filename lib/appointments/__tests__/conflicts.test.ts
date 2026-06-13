import { AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Vitest hoist-safe mock. The factory builds the in-memory fakes used by
// every test below; each test resets them via the helpers exported at the
// bottom of this file.
vi.mock('@/lib/db', () => {
  const NM = { fullNameEn: 'X', fullNameAr: 'س' };
  const state = {
    appointments: [] as Array<{
      id: string;
      patientId: string;
      therapistIds: string[];
      startsAt: Date;
      durationMinutes: number;
      status: AppointmentStatus;
    }>,
    leaves: [] as Array<{
      id: string;
      userId: string;
      startDate: Date;
      endDate: Date;
    }>,
    clinicHours: null as Record<string, { open: string; close: string; closed: boolean }> | null,
  };
  return {
    __state: state,
    db: {
      appointment: {
        // Mirrors the M2M query (Prompt 20): therapist scope is
        // `therapists: { some: { therapistId } }`; the include projects join
        // rows the engine maps via `c.therapists.map(t => t.therapist)`.
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const therapistScope = (where as { therapists?: { some?: { therapistId?: string } } })
            .therapists?.some?.therapistId;
          return state.appointments
            .filter((a) => {
              if (therapistScope && !a.therapistIds.includes(therapistScope)) return false;
              if ('patientId' in where && a.patientId !== where.patientId) return false;
              const statusWhere = where.status as { in?: AppointmentStatus[] } | undefined;
              if (statusWhere?.in && !statusWhere.in.includes(a.status)) return false;
              const idWhere = where.id as { not?: string } | undefined;
              if (idWhere?.not && a.id === idWhere.not) return false;
              return true;
            })
            .map((a) => ({
              ...a,
              patient: { id: a.patientId, ...NM },
              therapists: a.therapistIds.map((id) => ({ therapist: { id, ...NM } })),
            }));
        }),
      },
      user: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const ids = (where as { id?: { in?: string[] } }).id?.in ?? [];
          return ids.map((id) => ({ id, ...NM }));
        }),
      },
      leave: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const userIn = (where.userId as { in?: string[] } | undefined)?.in;
          return state.leaves.filter((l) => {
            if (userIn && !userIn.includes(l.userId)) return false;
            const start = (where.startDate as { lte?: Date } | undefined)?.lte;
            const end = (where.endDate as { gte?: Date } | undefined)?.gte;
            if (start && l.startDate > start) return false;
            if (end && l.endDate < end) return false;
            return true;
          });
        }),
      },
      clinicSettings: {
        findUnique: vi.fn(async () => ({ businessHours: state.clinicHours })),
      },
    },
  };
});

const dbMock = await import('@/lib/db');
const state = (dbMock as unknown as { __state: BlankState }).__state;
const { checkConflicts } = await import('../conflicts');

type BlankState = {
  appointments: Array<unknown>;
  leaves: Array<unknown>;
  clinicHours: Record<string, unknown> | null;
};

const HOURS_M_TO_F_9_TO_18 = {
  sun: { open: '09:00', close: '18:00', closed: false },
  mon: { open: '09:00', close: '18:00', closed: false },
  tue: { open: '09:00', close: '18:00', closed: false },
  wed: { open: '09:00', close: '18:00', closed: false },
  thu: { open: '09:00', close: '18:00', closed: false },
  fri: { open: '09:00', close: '18:00', closed: true },
  sat: { open: '10:00', close: '14:00', closed: false },
};

function addExistingAppt(args: {
  id?: string;
  therapistIds: string[];
  patientId: string;
  startsAt: string; // ISO
  durationMinutes: number;
  status?: AppointmentStatus;
}) {
  state.appointments.push({
    id: args.id ?? `appt-${state.appointments.length + 1}`,
    therapistIds: args.therapistIds,
    patientId: args.patientId,
    startsAt: new Date(args.startsAt),
    durationMinutes: args.durationMinutes,
    status: args.status ?? AppointmentStatus.SCHEDULED,
  } as never);
}

beforeEach(() => {
  state.appointments = [];
  state.leaves = [];
  state.clinicHours = HOURS_M_TO_F_9_TO_18;
});

// Pick a UTC weekday that is OPEN in the fixture above. 2026-06-01 is a
// Monday — open Sun-Thu, closed Fri, partial Sat.
const MONDAY = '2026-06-01';
const FRIDAY = '2026-06-05';

describe('checkConflicts — happy paths', () => {
  it('ok when no other appointments exist and within hours', async () => {
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });

  it('ok when adjacent appointment ends exactly at start (boundary)', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T09:30:00Z`,
      durationMinutes: 30,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });

  it('ok when adjacent appointment starts exactly at end (boundary)', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T10:30:00Z`,
      durationMinutes: 30,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });

  it('ignores COMPLETED appointments for overlap', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
      status: AppointmentStatus.COMPLETED,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });

  it('ignores CANCELLED appointments for overlap', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
      status: AppointmentStatus.CANCELLED,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });

  it('ignores NO_SHOW appointments for overlap', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
      status: AppointmentStatus.NO_SHOW,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });
});

describe('checkConflicts — therapist overlap', () => {
  it('detects exact-same-time overlap with another patient', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflicts.some((c) => c.kind === 'THERAPIST_OVERLAP')).toBe(true);
    }
  });

  it('detects partial overlap from before', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T09:45:00Z`,
      durationMinutes: 30, // 09:45 - 10:15
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
  });

  it('detects partial overlap from after', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T10:15:00Z`,
      durationMinutes: 30, // 10:15 - 10:45
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
  });

  it('detects an existing appointment fully containing the new one', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p2',
      startsAt: `${MONDAY}T09:00:00Z`,
      durationMinutes: 120, // 09:00 - 11:00
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
  });

  it('excludes the same appointment id when editing', async () => {
    addExistingAppt({
      id: 'self',
      therapistIds: ['t1'],
      patientId: 'p1',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
    });
    const result = await checkConflicts({
      appointmentId: 'self',
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });

  it('no overlap when the existing appointment belongs to a different therapist', async () => {
    addExistingAppt({
      therapistIds: ['t2'],
      patientId: 'p2',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });
});

describe('checkConflicts — patient overlap', () => {
  it('detects same patient with another therapist at the same time', async () => {
    addExistingAppt({
      therapistIds: ['t2'],
      patientId: 'p1',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflicts.some((c) => c.kind === 'PATIENT_OVERLAP')).toBe(true);
    }
  });

  it('reports both therapist and patient conflicts when both apply', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p1',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const kinds = result.conflicts.map((c) => c.kind);
      expect(kinds).toContain('THERAPIST_OVERLAP');
      expect(kinds).toContain('PATIENT_OVERLAP');
    }
  });
});

describe('checkConflicts — therapist leave', () => {
  it('detects single-day leave covering the appointment date', async () => {
    state.leaves.push({
      id: 'L1',
      userId: 't1',
      startDate: new Date(`${MONDAY}T00:00:00Z`),
      endDate: new Date(`${MONDAY}T00:00:00Z`),
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflicts.some((c) => c.kind === 'THERAPIST_ON_LEAVE')).toBe(true);
    }
  });

  it('detects multi-day leave whose end is the appointment date', async () => {
    state.leaves.push({
      id: 'L1',
      userId: 't1',
      startDate: new Date('2026-05-30T00:00:00Z'),
      endDate: new Date(`${MONDAY}T00:00:00Z`),
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
  });

  it('does not flag leave for a different therapist', async () => {
    state.leaves.push({
      id: 'L1',
      userId: 'other',
      startDate: new Date(`${MONDAY}T00:00:00Z`),
      endDate: new Date(`${MONDAY}T00:00:00Z`),
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });
});

describe('checkConflicts — business hours', () => {
  it('detects appointment starting before open time', async () => {
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T08:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const kinds = result.conflicts.map((c) => c.kind);
      expect(kinds).toContain('OUTSIDE_BUSINESS_HOURS');
    }
  });

  it('detects appointment ending after close time', async () => {
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T17:45:00Z`),
      durationMinutes: 30, // ends 18:15, after 18:00 close
    });
    expect(result.ok).toBe(false);
  });

  it('allows appointment starting exactly at open time', async () => {
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T09:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });

  it('allows appointment ending exactly at close time', async () => {
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T17:30:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects appointment on closed day (Friday in fixture)', async () => {
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${FRIDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflicts.some((c) => c.kind === 'CLINIC_CLOSED_THIS_DAY')).toBe(true);
    }
  });

  it('skips hours check when ClinicSettings has no business hours configured', async () => {
    state.clinicHours = null;
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T03:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });
});

describe('checkConflicts — aggregate behaviour', () => {
  it('returns ALL conflicts found, not just the first', async () => {
    addExistingAppt({
      therapistIds: ['t1'],
      patientId: 'p1',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
    });
    state.leaves.push({
      id: 'L1',
      userId: 't1',
      startDate: new Date(`${MONDAY}T00:00:00Z`),
      endDate: new Date(`${MONDAY}T00:00:00Z`),
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1'],
      startsAt: new Date(`${MONDAY}T08:00:00Z`), // also outside hours
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const kinds = new Set(result.conflicts.map((c) => c.kind));
      expect(kinds.has('THERAPIST_ON_LEAVE')).toBe(true);
      expect(kinds.has('OUTSIDE_BUSINESS_HOURS')).toBe(true);
    }
  });
});

describe('checkConflicts — multiple therapists (Prompt 20)', () => {
  it('blocks when ANY assigned therapist overlaps, and names that therapist', async () => {
    // t2 is busy at the slot; t1 is free. The two-therapist session must clash.
    addExistingAppt({
      therapistIds: ['t2'],
      patientId: 'pX',
      startsAt: `${MONDAY}T10:00:00Z`,
      durationMinutes: 30,
    });
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1', 't2'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const overlap = result.conflicts.find((c) => c.kind === 'THERAPIST_OVERLAP');
      expect(overlap).toBeDefined();
      if (overlap && overlap.kind === 'THERAPIST_OVERLAP') {
        expect(overlap.therapist.id).toBe('t2');
      }
    }
  });

  it('is OK when both assigned therapists are free', async () => {
    const result = await checkConflicts({
      patientId: 'p1',
      therapistIds: ['t1', 't2'],
      startsAt: new Date(`${MONDAY}T10:00:00Z`),
      durationMinutes: 30,
    });
    expect(result.ok).toBe(true);
  });
});
