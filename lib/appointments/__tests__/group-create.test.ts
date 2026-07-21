import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * July #8 part 3 — GROUP therapy / workshops. One appointment, several patients
 * (open capacity) held in the AppointmentPatient M2M (choice B — Hybrid). This
 * suite asserts the create-path side effects: a membership row per patient, the
 * care-team fan-out (every member × every therapist), and one reminder job
 * (the worker fans it out per member; send stays deferred).
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'actor-1', role: 'SECRETARY' } })),
}));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => ({ isImpersonating: false, user: { id: 'actor-1' } })),
}));
vi.mock('../conflicts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, checkConflicts: vi.fn(async () => ({ ok: true })) };
});
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  enqueueAppointmentReminder: vi.fn(async () => {}),
  cancelAppointmentReminder: vi.fn(async () => {}),
}));
vi.mock('@/lib/queue/jobs/autoCompleteSession', () => ({
  enqueueAutoCompleteSession: vi.fn(async () => {}),
  cancelAutoCompleteSession: vi.fn(async () => {}),
}));
vi.mock('@/lib/notifications/actions', () => ({
  createNotification: vi.fn(async () => ({ id: 'n' })),
}));

vi.mock('@/lib/db', () => {
  interface Member {
    patientId: string;
    clinicianId: string;
    role: string;
    assignedBy: string;
  }
  const state = {
    users: [
      { id: 'therapist-1', role: 'THERAPIST', deletedAt: null },
      { id: 'therapist-2', role: 'THERAPIST', deletedAt: null },
      { id: 'patient-1', role: 'PATIENT', deletedAt: null },
      { id: 'patient-2', role: 'PATIENT', deletedAt: null },
      { id: 'patient-3', role: 'PATIENT', deletedAt: null },
    ],
    appointments: [] as Array<Record<string, unknown>>,
    appointmentPatients: [] as Array<{ appointmentId: string; patientId: string }>,
    appointmentTherapists: [] as Array<{ appointmentId: string; therapistId: string }>,
    members: [] as Member[],
    counter: 0,
  };
  const dbObj = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbObj)),
    appointment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.counter += 1;
        const id = `appt-${state.counter}`;
        state.appointments.push({ id, ...data });
        const therapists =
          (data as { therapists?: { create?: Array<{ therapistId: string }> } }).therapists
            ?.create ?? [];
        for (const t of therapists) {
          state.appointmentTherapists.push({ appointmentId: id, therapistId: t.therapistId });
        }
        const groupPatients =
          (data as { groupPatients?: { create?: Array<{ patientId: string }> } }).groupPatients
            ?.create ?? [];
        for (const g of groupPatients) {
          state.appointmentPatients.push({ appointmentId: id, patientId: g.patientId });
        }
        return { id, ...data };
      }),
    },
    careTeamMember: {
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { patientId_clinicianId: { patientId: string; clinicianId: string } };
          create: Member;
        }) => {
          const { patientId, clinicianId } = where.patientId_clinicianId;
          const existing = state.members.find(
            (m) => m.patientId === patientId && m.clinicianId === clinicianId,
          );
          if (existing) return existing;
          state.members.push(create);
          return create;
        },
      ),
    },
    user: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; deletedAt?: null } }) => {
        const u = state.users.find((x) => x.id === where.id && x.deletedAt === null);
        return u ? { role: u.role } : null;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          state.users.find((x) => x.id === where.id) ?? null,
      ),
    },
    clinicSettings: {
      findUnique: vi.fn(async () => ({ defaultReminderOffsetMinutes: 30 })),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
  };
  return {
    __state: state,
    db: dbObj,
    toLocalizedError: (e: unknown) => ({ code: 'X', message_en: String(e), message_ar: '' }),
  };
});

import { enqueueAppointmentReminder } from '@/lib/queue/jobs/appointmentReminder';

import { createAppointment } from '../services';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    appointments: Array<Record<string, unknown>>;
    appointmentPatients: Array<{ appointmentId: string; patientId: string }>;
    members: Array<{ patientId: string; clinicianId: string }>;
    counter: number;
  };
};

const futureStart = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(8, 0, 0, 0);
  return d;
};

const groupCreate = {
  patientId: null,
  patientIds: ['patient-1', 'patient-2', 'patient-3'],
  therapistIds: ['therapist-1', 'therapist-2'],
  appointmentType: 'GROUP',
  title: 'Back-care workshop',
  startsAt: futureStart(),
  durationMinutes: 45,
  roomId: null,
  notes: null,
  overrideConflicts: false,
} as unknown as Parameters<typeof createAppointment>[0];

beforeEach(() => {
  __state.appointments.length = 0;
  __state.appointmentPatients.length = 0;
  __state.members.length = 0;
  __state.counter = 0;
  vi.mocked(enqueueAppointmentReminder).mockClear();
});

describe('GROUP create path (July #8 part 3)', () => {
  it('stores the scalar patient as null and one AppointmentPatient row per member', async () => {
    const { appointmentId } = await createAppointment(groupCreate);
    expect(__state.appointments[0]!.patientId).toBeNull();
    const rows = __state.appointmentPatients.filter((r) => r.appointmentId === appointmentId);
    expect(rows.map((r) => r.patientId).sort()).toEqual(['patient-1', 'patient-2', 'patient-3']);
  });

  it('fans the care team across every member × every therapist (6 links, idempotent)', async () => {
    await createAppointment(groupCreate);
    // 3 patients × 2 therapists = 6 distinct memberships.
    expect(__state.members).toHaveLength(6);
    const pairs = __state.members.map((m) => `${m.patientId}:${m.clinicianId}`).sort();
    expect(pairs).toEqual([
      'patient-1:therapist-1',
      'patient-1:therapist-2',
      'patient-2:therapist-1',
      'patient-2:therapist-2',
      'patient-3:therapist-1',
      'patient-3:therapist-2',
    ]);
    // Re-booking the identical group does not duplicate memberships.
    await createAppointment(groupCreate);
    expect(__state.members).toHaveLength(6);
  });

  it('enqueues exactly one reminder job (worker fans out per member)', async () => {
    await createAppointment(groupCreate);
    expect(enqueueAppointmentReminder).toHaveBeenCalledTimes(1);
  });
});
