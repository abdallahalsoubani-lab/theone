import { AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = {
    appointments: [] as Array<{
      id: string;
      therapistId: string;
      patientId: string;
      startsAt: Date;
      durationMinutes: number;
      status: AppointmentStatus;
      patient: { id: string; fullNameEn: string; fullNameAr: string };
    }>,
  };
  return {
    __state: state,
    db: {
      appointment: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          return state.appointments.filter((a) => {
            if (a.therapistId !== (where.therapistId as string)) return false;
            const statusIn = (where.status as { in?: AppointmentStatus[] } | undefined)?.in;
            if (statusIn && !statusIn.includes(a.status)) return false;
            const startsAt = where.startsAt as { gte?: Date; lte?: Date } | undefined;
            if (startsAt?.gte && a.startsAt < startsAt.gte) return false;
            if (startsAt?.lte && a.startsAt > startsAt.lte) return false;
            return true;
          });
        }),
      },
    },
  };
});

const dbMock = await import('@/lib/db');
const state = (dbMock as unknown as { __state: { appointments: Appt[] } }).__state;
const { scanLeaveConflicts } = await import('../conflictScan');

interface Appt {
  id: string;
  therapistId: string;
  patientId: string;
  startsAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  patient: { id: string; fullNameEn: string; fullNameAr: string };
}

function add(args: {
  id: string;
  therapistId: string;
  patientId?: string;
  startsAt: string;
  status?: AppointmentStatus;
}) {
  state.appointments.push({
    id: args.id,
    therapistId: args.therapistId,
    patientId: args.patientId ?? 'p1',
    startsAt: new Date(args.startsAt),
    durationMinutes: 30,
    status: args.status ?? AppointmentStatus.SCHEDULED,
    patient: { id: args.patientId ?? 'p1', fullNameEn: 'Patient One', fullNameAr: 'مريض ١' },
  });
}

beforeEach(() => {
  state.appointments = [];
});

describe('scanLeaveConflicts', () => {
  it('returns appointments for the leave-taker within the window', async () => {
    add({ id: 'a1', therapistId: 't1', startsAt: '2026-06-02T10:00:00Z' });
    add({ id: 'a2', therapistId: 't1', startsAt: '2026-06-03T10:00:00Z' });
    const out = await scanLeaveConflicts({
      userId: 't1',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-05'),
    });
    expect(out.map((c) => c.appointmentId).sort()).toEqual(['a1', 'a2']);
  });

  it('includes the boundary days inclusively', async () => {
    add({ id: 'start', therapistId: 't1', startsAt: '2026-06-01T08:00:00Z' });
    add({ id: 'end', therapistId: 't1', startsAt: '2026-06-05T22:00:00Z' });
    const out = await scanLeaveConflicts({
      userId: 't1',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-05'),
    });
    expect(out.map((c) => c.appointmentId).sort()).toEqual(['end', 'start']);
  });

  it('ignores appointments for a different therapist', async () => {
    add({ id: 'a1', therapistId: 't1', startsAt: '2026-06-02T10:00:00Z' });
    add({ id: 'a2', therapistId: 't2', startsAt: '2026-06-02T11:00:00Z' });
    const out = await scanLeaveConflicts({
      userId: 't1',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-05'),
    });
    expect(out.map((c) => c.appointmentId)).toEqual(['a1']);
  });

  it('ignores terminal-status appointments (cancelled / completed / no-show)', async () => {
    add({ id: 'live', therapistId: 't1', startsAt: '2026-06-02T10:00:00Z' });
    add({
      id: 'cancelled',
      therapistId: 't1',
      startsAt: '2026-06-02T11:00:00Z',
      status: AppointmentStatus.CANCELLED,
    });
    add({
      id: 'completed',
      therapistId: 't1',
      startsAt: '2026-06-02T12:00:00Z',
      status: AppointmentStatus.COMPLETED,
    });
    add({
      id: 'noshow',
      therapistId: 't1',
      startsAt: '2026-06-02T13:00:00Z',
      status: AppointmentStatus.NO_SHOW,
    });
    const out = await scanLeaveConflicts({
      userId: 't1',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-05'),
    });
    expect(out.map((c) => c.appointmentId)).toEqual(['live']);
  });

  it('returns empty when no appointments fall in the window', async () => {
    add({ id: 'before', therapistId: 't1', startsAt: '2026-05-25T10:00:00Z' });
    add({ id: 'after', therapistId: 't1', startsAt: '2026-06-10T10:00:00Z' });
    const out = await scanLeaveConflicts({
      userId: 't1',
      startDate: new Date('2026-06-01'),
      endDate: new Date('2026-06-05'),
    });
    expect(out).toEqual([]);
  });
});
