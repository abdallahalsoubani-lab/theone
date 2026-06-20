import { AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// withAudit reads the session via @/lib/impersonation/session unless an
// actorOverride is set (the worker sets one) — mock @/auth so the import graph
// is safe in the test env, mirroring the kiosk test.
vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));

vi.mock('@/lib/db', () => {
  type Appt = { id: string; startsAt: Date; durationMinutes: number; status: AppointmentStatus };
  const state = {
    grace: {
      sessionStartGraceMinutes: 15,
      sessionAutoCompleteGraceMinutes: 15,
      timezone: 'Asia/Amman',
    },
    appts: [] as Appt[],
    audits: [] as Array<{ actorId: string; entityId: string; after: unknown }>,
  };
  return {
    __state: state,
    db: {
      clinicSettings: { findUnique: vi.fn(async () => state.grace) },
      appointment: {
        findMany: vi.fn(async ({ where }: { where: { status: AppointmentStatus } }) =>
          state.appts
            .filter((a) => a.status === where.status)
            .map((a) => ({
              id: a.id,
              startsAt: a.startsAt,
              durationMinutes: a.durationMinutes,
            })),
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; status: AppointmentStatus };
            data: { status: AppointmentStatus };
          }) => {
            const appt = state.appts.find((a) => a.id === where.id && a.status === where.status);
            if (!appt) return { count: 0 };
            appt.status = data.status;
            return { count: 1 };
          },
        ),
      },
      auditLog: {
        create: vi.fn(
          async ({ data }: { data: { actorId: string; entityId: string; after: unknown } }) => {
            state.audits.push({
              actorId: data.actorId,
              entityId: data.entityId,
              after: data.after,
            });
            return data;
          },
        ),
      },
    },
  };
});

const dbMock = await import('@/lib/db');
const state = (dbMock as unknown as { __state: BlankState }).__state;
const { autoCompleteOverdueSessions } = await import('../autoComplete');

type BlankState = {
  grace: { sessionAutoCompleteGraceMinutes: number };
  appts: Array<{ id: string; startsAt: Date; durationMinutes: number; status: AppointmentStatus }>;
  audits: Array<{ actorId: string; entityId: string; after: unknown }>;
};

const START = new Date('2026-06-01T13:00:00Z'); // ends 13:30Z; +15 grace = 13:45Z
const NOW = new Date('2026-06-01T13:50:00Z'); // 20 min after end

beforeEach(() => {
  state.appts = [];
  state.audits = [];
  state.grace.sessionAutoCompleteGraceMinutes = 15;
});

describe('autoCompleteOverdueSessions', () => {
  it('completes an in-session appointment overdue past the grace, audited as system (Receptionist #21)', async () => {
    state.appts.push({
      id: 'a1',
      startsAt: START,
      durationMinutes: 30,
      status: AppointmentStatus.IN_PROGRESS,
    });
    const r = await autoCompleteOverdueSessions(NOW);
    expect(r).toEqual({ scanned: 1, completed: 1 });
    expect(state.appts[0]!.status).toBe(AppointmentStatus.COMPLETED);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]!.actorId).toBe('system');
    expect(state.audits[0]!.after).toEqual({ event: 'SESSION_AUTO_COMPLETED' });
  });

  it('does NOT complete a session still inside the grace window', async () => {
    // ended 5 min ago (now 13:35) — inside the 15-min grace.
    state.appts.push({
      id: 'a1',
      startsAt: START,
      durationMinutes: 30,
      status: AppointmentStatus.IN_PROGRESS,
    });
    const r = await autoCompleteOverdueSessions(new Date('2026-06-01T13:35:00Z'));
    expect(r.completed).toBe(0);
    expect(state.appts[0]!.status).toBe(AppointmentStatus.IN_PROGRESS);
    expect(state.audits).toHaveLength(0);
  });

  it('never touches cancelled / no-show / already-completed appointments past the threshold', async () => {
    for (const status of [
      AppointmentStatus.CANCELLED,
      AppointmentStatus.NO_SHOW,
      AppointmentStatus.COMPLETED,
    ]) {
      state.appts.push({ id: `x-${status}`, startsAt: START, durationMinutes: 30, status });
    }
    const r = await autoCompleteOverdueSessions(NOW);
    expect(r).toEqual({ scanned: 0, completed: 0 });
    expect(state.audits).toHaveLength(0);
  });

  it('is idempotent — a second run completes nothing and writes no duplicate audit', async () => {
    state.appts.push({
      id: 'a1',
      startsAt: START,
      durationMinutes: 30,
      status: AppointmentStatus.IN_PROGRESS,
    });
    const first = await autoCompleteOverdueSessions(NOW);
    const second = await autoCompleteOverdueSessions(NOW);
    expect(first.completed).toBe(1);
    expect(second.completed).toBe(0);
    expect(state.audits).toHaveLength(1);
  });
});
