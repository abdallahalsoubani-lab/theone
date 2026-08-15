import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prompt 41 — NI-5, owner ruling: SOFT enforcement. The system must NEVER
 * block booking a therapy SESSION for a patient who hasn't completed their
 * first doctor visit — the inline notice in the modal is the enforcement
 * ceiling. This suite is the regression guard: if anyone ever adds a
 * first-visit gate to the create path, these bookings start failing here.
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
const dispatchMock = vi.hoisted(() =>
  vi.fn(async () => ({ entryId: 'd1', suppressed: null, confirmWasPending: false })),
);
vi.mock('@/lib/whatsapp/dispatch/service', () => ({
  recordDispatchEvent: dispatchMock,
}));
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  enqueueAppointmentReminder: vi.fn(async () => {}),
  cancelAppointmentReminder: vi.fn(async () => {}),
  scheduleLifecycleMessage: vi.fn(async () => null),
  cancelLifecycleMessages: vi.fn(async () => ({ confirmWasPending: false })),
}));
vi.mock('@/lib/queue/jobs/autoCompleteSession', () => ({
  enqueueAutoCompleteSession: vi.fn(async () => {}),
  cancelAutoCompleteSession: vi.fn(async () => {}),
}));
vi.mock('@/lib/notifications/actions', () => ({
  createNotification: vi.fn(async () => ({ id: 'n' })),
}));

vi.mock('@/lib/db', () => {
  const state = {
    users: [
      {
        id: 'therapist-1',
        role: 'THERAPIST',
        fullNameEn: 'T1',
        fullNameAr: 'T1',
        deletedAt: null,
        whatsappReachable: false,
        phone: '+962790000001',
        languagePref: 'EN',
      },
      {
        id: 'doctor-1',
        role: 'DOCTOR',
        fullNameEn: 'D1',
        fullNameAr: 'D1',
        deletedAt: null,
        whatsappReachable: false,
        phone: '+962790000002',
        languagePref: 'EN',
      },
      // The pending-first-visit patient: ZERO appointments of any kind.
      {
        id: 'patient-1',
        role: 'PATIENT',
        fullNameEn: 'P1',
        fullNameAr: 'P1',
        deletedAt: null,
        whatsappReachable: false,
        phone: '+962790000003',
        languagePref: 'EN',
      },
    ],
    appointments: [] as Array<Record<string, unknown>>,
    appointmentTherapists: [] as Array<{ appointmentId: string; therapistId: string }>,
    members: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
    counter: 0,
  };
  const dbObj = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(dbObj)),
    appointment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.counter += 1;
        const id = `appt-${state.counter}`;
        const row = { id, ...data };
        state.appointments.push(row);
        const nested =
          (data as { therapists?: { create?: Array<{ therapistId: string }> } }).therapists
            ?.create ?? [];
        for (const t of nested) {
          state.appointmentTherapists.push({ appointmentId: id, therapistId: t.therapistId });
        }
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = state.appointments.find((x) => x.id === where.id);
        if (!a) return null;
        const patient = state.users.find((u) => u.id === a.patientId);
        return {
          ...a,
          patient: patient
            ? { fullNameEn: patient.fullNameEn, fullNameAr: patient.fullNameAr }
            : null,
        };
      }),
      // If a first-visit gate were ever (wrongly) added to the create path,
      // its derivation query would land here.
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    appointmentTherapist: {
      findMany: vi.fn(async ({ where }: { where: { appointmentId: string } }) =>
        state.appointmentTherapists
          .filter((t) => t.appointmentId === where.appointmentId)
          .map((t) => ({ therapistId: t.therapistId })),
      ),
    },
    careTeamMember: {
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        state.members.push(create);
        return create;
      }),
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
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      }),
    },
  };
  return {
    __state: state,
    db: dbObj,
    toLocalizedError: (e: unknown) => ({ code: 'X', message_en: String(e), message_ar: '' }),
  };
});

import { createAppointment } from '../services';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    appointments: Array<Record<string, unknown>>;
    appointmentTherapists: Array<{ appointmentId: string; therapistId: string }>;
    members: Array<Record<string, unknown>>;
    counter: number;
  };
};

const futureStart = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(8, 0, 0, 0);
  return d;
};

beforeEach(() => {
  __state.appointments.length = 0;
  __state.appointmentTherapists.length = 0;
  __state.members.length = 0;
  __state.counter = 0;
});

describe('soft enforcement — pending first visit NEVER blocks booking', () => {
  it('a therapy SESSION for a patient with zero appointments books successfully', async () => {
    const result = await createAppointment({
      patientId: 'patient-1',
      therapistIds: ['therapist-1'],
      startsAt: futureStart(),
      durationMinutes: 30,
      roomId: 'room-1',
      notes: null,
      overrideConflicts: false,
    } as Parameters<typeof createAppointment>[0]);
    expect(result.appointmentId).toBeTruthy();
    expect(__state.appointments).toHaveLength(1);
  });

  it('a doctor visit for the same patient books through the same path', async () => {
    const result = await createAppointment({
      patientId: 'patient-1',
      therapistIds: ['doctor-1'],
      startsAt: futureStart(),
      durationMinutes: 30,
      roomId: 'room-1',
      notes: null,
      overrideConflicts: false,
    } as Parameters<typeof createAppointment>[0]);
    expect(result.appointmentId).toBeTruthy();
    expect(__state.appointmentTherapists.filter((t) => t.therapistId === 'doctor-1')).toHaveLength(
      1,
    );
  });
});
