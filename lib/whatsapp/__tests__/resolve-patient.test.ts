import { AppointmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P57 — `resolvePatientForInbound`: THE rule for which patient an inbound
 * message from a shared family number belongs to. Nearest active appointment
 * wins; else most recently active; single holder is a fast path; every
 * tie-break is deterministic.
 */

interface U {
  id: string;
  phone: string;
  role: string;
  deletedAt: Date | null;
  fullNameEn: string;
  fullNameAr: string;
  languagePref: 'AR' | 'EN';
  createdAt: Date;
  updatedAt: Date;
}
interface A {
  id: string;
  patientId: string;
  status: AppointmentStatus;
  startsAt: Date;
  durationMinutes: number;
}

const state = {
  users: [] as U[],
  appointments: [] as A[],
  reminded: new Set<string>(),
  appointmentQueries: 0,
};

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(async ({ where }: { where: { phone: string } }) =>
        state.users.filter(
          (u) => u.phone === where.phone && u.deletedAt === null && u.role === 'PATIENT',
        ),
      ),
    },
    appointment: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        state.appointmentQueries += 1;
        const ids = (where.patientId as { in: string[] }).in;
        const statuses = (where.status as { in: string[] }).in;
        const gte = (where.startsAt as { gte?: Date } | undefined)?.gte;
        return state.appointments
          .filter(
            (a) =>
              ids.includes(a.patientId) &&
              statuses.includes(a.status) &&
              (!gte || a.startsAt.getTime() >= gte.getTime()),
          )
          .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
      }),
    },
    whatsAppMessage: {
      findMany: vi.fn(async ({ where }: { where: { appointmentId: { in: string[] } } }) =>
        where.appointmentId.in
          .filter((id) => state.reminded.has(id))
          .map((appointmentId) => ({ appointmentId })),
      ),
    },
  },
}));

import { resolvePatientForInbound } from '../inbound/resolve-patient';

const PHONE = '+962790000000';
const NOW = new Date('2026-08-27T10:00:00Z');
const H = 60 * 60 * 1000;

function user(id: string, extra: Partial<U> = {}): U {
  return {
    id,
    phone: PHONE,
    role: 'PATIENT',
    deletedAt: null,
    fullNameEn: id,
    fullNameAr: '',
    languagePref: 'AR',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...extra,
  };
}
function appt(
  id: string,
  patientId: string,
  startsAt: Date,
  status: AppointmentStatus = AppointmentStatus.SCHEDULED,
): A {
  return { id, patientId, status, startsAt, durationMinutes: 30 };
}

beforeEach(() => {
  state.users = [];
  state.appointments = [];
  state.reminded = new Set();
  state.appointmentQueries = 0;
});

describe('resolvePatientForInbound', () => {
  it('returns null when nobody active holds the phone', async () => {
    state.users.push(user('archived', { deletedAt: new Date() }));
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient).toBeNull();
    expect(r.reason).toBe('NONE');
    expect(r.candidates).toHaveLength(0);
  });

  it('single holder — fast path, no appointment query at all', async () => {
    state.users.push(user('only'));
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient?.id).toBe('only');
    expect(r.reason).toBe('SINGLE');
    expect(state.appointmentQueries).toBe(0);
  });

  it('ignores staff rows and archived patients on the same number', async () => {
    state.users.push(
      user('child-a'),
      user('old', { deletedAt: new Date() }),
      user('sec', { role: 'SECRETARY' }),
    );
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient?.id).toBe('child-a');
    expect(r.reason).toBe('SINGLE');
  });

  it('nearest ACTIVE appointment wins (upcoming first)', async () => {
    state.users.push(user('child-a'), user('child-b'));
    state.appointments.push(
      appt('a1', 'child-a', new Date(NOW.getTime() + 4 * H)),
      appt('b1', 'child-b', new Date(NOW.getTime() + 2 * H)),
    );
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient?.id).toBe('child-b');
    expect(r.reason).toBe('NEAREST_APPOINTMENT');
  });

  it('a CANCELLED / COMPLETED / already-ended booking is not "active"', async () => {
    state.users.push(user('child-a'), user('child-b'));
    state.appointments.push(
      appt('a1', 'child-a', new Date(NOW.getTime() + 1 * H), AppointmentStatus.CANCELLED),
      // Ended 30 minutes ago (30-min slot starting 1h ago).
      appt('a2', 'child-a', new Date(NOW.getTime() - 1 * H)),
      appt('b1', 'child-b', new Date(NOW.getTime() + 5 * H), AppointmentStatus.CONFIRMED),
    );
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient?.id).toBe('child-b');
  });

  it('an IN_PROGRESS session that has not ended counts as active', async () => {
    state.users.push(user('child-a'), user('child-b'));
    state.appointments.push(
      {
        ...appt(
          'a1',
          'child-a',
          new Date(NOW.getTime() - 10 * 60 * 1000),
          AppointmentStatus.IN_PROGRESS,
        ),
        durationMinutes: 60,
      },
      appt('b1', 'child-b', new Date(NOW.getTime() + 1 * H)),
    );
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient?.id).toBe('child-a');
  });

  it('same-minute tie → the appointment a reminder was sent for', async () => {
    state.users.push(user('child-a'), user('child-b'));
    const t = new Date(NOW.getTime() + 2 * H);
    state.appointments.push(appt('a1', 'child-a', t), appt('b1', 'child-b', t));
    state.reminded.add('b1');
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient?.id).toBe('child-b');
  });

  it('same-minute tie, neither reminded → older patient record, then id', async () => {
    state.users.push(
      user('child-b', { createdAt: new Date('2026-02-01T00:00:00Z') }),
      user('child-a', { createdAt: new Date('2026-03-01T00:00:00Z') }),
    );
    const t = new Date(NOW.getTime() + 2 * H);
    state.appointments.push(appt('a1', 'child-a', t), appt('b1', 'child-b', t));
    expect((await resolvePatientForInbound(PHONE, NOW)).patient?.id).toBe('child-b');

    // Identical createdAt → id asc.
    state.users[1]!.createdAt = state.users[0]!.createdAt;
    expect((await resolvePatientForInbound(PHONE, NOW)).patient?.id).toBe('child-a');
  });

  it('no active appointment → most recent past appointment wins', async () => {
    state.users.push(user('child-a'), user('child-b'));
    state.appointments.push(
      appt('a1', 'child-a', new Date(NOW.getTime() - 30 * 24 * H), AppointmentStatus.COMPLETED),
      appt('b1', 'child-b', new Date(NOW.getTime() - 2 * 24 * H), AppointmentStatus.NO_SHOW),
      // A cancelled booking never counts as activity.
      appt('a2', 'child-a', new Date(NOW.getTime() - 1 * 24 * H), AppointmentStatus.CANCELLED),
    );
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient?.id).toBe('child-b');
    expect(r.reason).toBe('RECENT_APPOINTMENT');
  });

  it('a holder with any appointment outranks one with none', async () => {
    state.users.push(
      user('child-a', { updatedAt: new Date('2026-08-26T00:00:00Z') }),
      user('child-b', { updatedAt: new Date('2026-01-01T00:00:00Z') }),
    );
    state.appointments.push(
      appt('b1', 'child-b', new Date(NOW.getTime() - 60 * 24 * H), AppointmentStatus.COMPLETED),
    );
    expect((await resolvePatientForInbound(PHONE, NOW)).patient?.id).toBe('child-b');
  });

  it('nobody has an appointment → most recently updated profile, then id', async () => {
    state.users.push(
      user('child-a', { updatedAt: new Date('2026-05-01T00:00:00Z') }),
      user('child-b', { updatedAt: new Date('2026-06-01T00:00:00Z') }),
    );
    const r = await resolvePatientForInbound(PHONE, NOW);
    expect(r.patient?.id).toBe('child-b');
    expect(r.reason).toBe('RECENT_PROFILE');

    state.users[0]!.updatedAt = state.users[1]!.updatedAt;
    expect((await resolvePatientForInbound(PHONE, NOW)).patient?.id).toBe('child-a');
  });

  it('is deterministic — repeated calls on the same state agree', async () => {
    state.users.push(user('child-a'), user('child-b'), user('child-c'));
    const t = new Date(NOW.getTime() + 3 * H);
    state.appointments.push(
      appt('a1', 'child-a', t),
      appt('b1', 'child-b', t),
      appt('c1', 'child-c', t),
    );
    const first = (await resolvePatientForInbound(PHONE, NOW)).patient?.id;
    for (let i = 0; i < 5; i += 1) {
      expect((await resolvePatientForInbound(PHONE, NOW)).patient?.id).toBe(first);
    }
    expect(first).toBe('child-a');
  });
});
