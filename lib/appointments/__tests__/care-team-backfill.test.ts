import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pre-Prompt-16 fix — booking / rescheduling / changing-therapist on an
 * appointment auto-adds that therapist to the patient's care team
 * (idempotent, add-never-replace). Asserts the membership side-effect of the
 * appointment service mutations.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'actor-1', role: 'SECRETARY' } })),
}));
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () => ({ isImpersonating: false, user: { id: 'actor-1' } })),
}));
vi.mock('../conflicts', async (importOriginal) => {
  // Keep the real hard-block helpers; stub only the engine call.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    checkConflicts: vi.fn(async () => ({ ok: true })),
  };
});
vi.mock('@/lib/queue/jobs/appointmentReminder', () => ({
  enqueueAppointmentReminder: vi.fn(async () => {}),
  cancelAppointmentReminder: vi.fn(async () => {}),
  scheduleLifecycleMessage: vi.fn(async () => null),
  cancelLifecycleMessages: vi.fn(async () => ({ confirmWasPending: false })),
}));
vi.mock('@/lib/whatsapp/templates/sendConfirmation', () => ({
  confirmationAlreadySent: vi.fn(async () => true),
  sendAppointmentConfirmation: vi.fn(async () => undefined),
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
        id: 'therapist-2',
        role: 'THERAPIST',
        fullNameEn: 'T2',
        fullNameAr: 'T2',
        deletedAt: null,
        whatsappReachable: false,
        phone: '+962790000002',
        languagePref: 'EN',
      },
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
    members: [] as Member[],
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
        // Mirror the nested `therapists: { create: [...] }` write (Prompt 20).
        const nested =
          (data as { therapists?: { create?: Array<{ therapistId: string }> } }).therapists
            ?.create ?? [];
        for (const t of nested) {
          state.appointmentTherapists.push({ appointmentId: id, therapistId: t.therapistId });
        }
        return row;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const a = state.appointments.find((x) => x.id === where.id)!;
          Object.assign(a, data);
          return a;
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = state.appointments.find((x) => x.id === where.id);
        if (!a) return null;
        // Attach the nested `patient` relation some callers select.
        const patient = state.users.find((u) => u.id === a.patientId);
        return {
          ...a,
          patient: patient
            ? { fullNameEn: patient.fullNameEn, fullNameAr: patient.fullNameAr }
            : null,
          // Reschedule selects GROUP membership (R-22, Prompt 42).
          groupPatients: [],
        };
      }),
    },
    appointmentTherapist: {
      findMany: vi.fn(async ({ where }: { where: { appointmentId: string } }) =>
        state.appointmentTherapists
          .filter((t) => t.appointmentId === where.appointmentId)
          .map((t) => ({ therapistId: t.therapistId })),
      ),
      create: vi.fn(async ({ data }: { data: { appointmentId: string; therapistId: string } }) => {
        state.appointmentTherapists.push(data);
        return data;
      }),
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: { appointmentId: string; therapistId?: { in?: string[] } };
        }) => {
          const remove = where.therapistId?.in ?? [];
          state.appointmentTherapists = state.appointmentTherapists.filter(
            (t) => !(t.appointmentId === where.appointmentId && remove.includes(t.therapistId)),
          );
          return { count: remove.length };
        },
      ),
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

import { checkConflicts } from '../conflicts';
import { createAppointment, rescheduleAppointment, changeAppointmentTherapist } from '../services';

const { __state } = (await import('@/lib/db')) as unknown as {
  __state: {
    appointments: Array<Record<string, unknown>>;
    appointmentTherapists: Array<{ appointmentId: string; therapistId: string }>;
    members: Array<{ patientId: string; clinicianId: string; role: string; assignedBy: string }>;
    counter: number;
  };
};

// Always-in-the-future start so the past-time booking guard (71e61c9) never
// time-bombs this suite the way the fixed 2026-07-01 fixture did. Tuesday-ish
// mid-morning is inside seeded working hours regardless of the actual day
// because the conflict engine is mocked here.
const futureStart = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(8, 0, 0, 0);
  return d;
};

const baseCreate = {
  patientId: 'patient-1',
  therapistIds: ['therapist-1'],
  startsAt: futureStart(),
  durationMinutes: 30,
  roomId: 'room-1',
  notes: null,
  overrideConflicts: false,
} as Parameters<typeof createAppointment>[0];

beforeEach(() => {
  __state.appointments.length = 0;
  __state.appointmentTherapists.length = 0;
  __state.members.length = 0;
  __state.counter = 0;
});

describe('booking adds the therapist to the care team', () => {
  it('createAppointment adds (patient, therapist) as THERAPIST', async () => {
    await createAppointment(baseCreate);
    expect(__state.members).toHaveLength(1);
    expect(__state.members[0]).toMatchObject({
      patientId: 'patient-1',
      clinicianId: 'therapist-1',
      role: 'THERAPIST',
      assignedBy: 'actor-1',
    });
  });

  it('a duplicate booking with the same therapist does not duplicate the membership', async () => {
    await createAppointment(baseCreate);
    await createAppointment(baseCreate);
    expect(__state.members.filter((m) => m.clinicianId === 'therapist-1')).toHaveLength(1);
  });

  it('booking a two-therapist session adds BOTH to the care team (Prompt 20)', async () => {
    await createAppointment({
      ...baseCreate,
      therapistIds: ['therapist-1', 'therapist-2'],
    } as Parameters<typeof createAppointment>[0]);
    const ids = __state.members.map((m) => m.clinicianId).sort();
    expect(ids).toEqual(['therapist-1', 'therapist-2']);
  });
});

describe('reschedule / change-therapist add the new therapist (never remove)', () => {
  it('rescheduling onto a different therapist adds the new one and keeps the original', async () => {
    const { appointmentId } = await createAppointment(baseCreate);
    await rescheduleAppointment({
      id: appointmentId,
      startsAt: new Date(futureStart().getTime() + 60 * 60 * 1000),
      durationMinutes: 30,
      therapistIds: ['therapist-2'],
      roomId: null,
      overrideConflicts: false,
    } as Parameters<typeof rescheduleAppointment>[0]);

    const ids = __state.members.map((m) => m.clinicianId).sort();
    expect(ids).toEqual(['therapist-1', 'therapist-2']);
  });

  it('changeAppointmentTherapist adds the new therapist', async () => {
    const { appointmentId } = await createAppointment(baseCreate);
    await changeAppointmentTherapist({
      id: appointmentId,
      therapistIds: ['therapist-2'],
      reason: 'cover',
      overrideConflicts: false,
    } as Parameters<typeof changeAppointmentTherapist>[0]);

    expect(__state.members.some((m) => m.clinicianId === 'therapist-2')).toBe(true);
    expect(__state.members.some((m) => m.clinicianId === 'therapist-1')).toBe(true);
  });
});

describe('hard-blocked conflicts reject even with override (Prompt 22 §4.1/§4.2)', () => {
  it('rescheduleAppointment with overrideConflicts=true still rejects PATIENT_OVERLAP', async () => {
    const { appointmentId } = await createAppointment(baseCreate);
    vi.mocked(checkConflicts).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'PATIENT_OVERLAP', appointment: {} }],
    } as never);
    await expect(
      rescheduleAppointment({
        id: appointmentId,
        startsAt: new Date(futureStart().getTime() + 60 * 60 * 1000),
        durationMinutes: 30,
        therapistIds: ['therapist-2'],
        roomId: null,
        overrideConflicts: true,
      } as Parameters<typeof rescheduleAppointment>[0]),
    ).rejects.toMatchObject({ error: { code: 'APPOINTMENT_SAME_PATIENT_OVERLAP' } });
  });

  it('changeAppointmentTherapist with override still rejects a closed-day hard block', async () => {
    const { appointmentId } = await createAppointment(baseCreate);
    vi.mocked(checkConflicts).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'CLINIC_CLOSED_THIS_DAY', dayKey: 'fri' }],
    } as never);
    await expect(
      changeAppointmentTherapist({
        id: appointmentId,
        therapistIds: ['therapist-2'],
        reason: 'cover',
        overrideConflicts: true,
      } as Parameters<typeof changeAppointmentTherapist>[0]),
    ).rejects.toMatchObject({ error: { code: 'APPOINTMENT_ON_CLOSED_DAY' } });
  });

  it('soft conflicts stay overridable (therapist overlap + override succeeds)', async () => {
    const { appointmentId } = await createAppointment(baseCreate);
    vi.mocked(checkConflicts).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'THERAPIST_OVERLAP', therapist: {}, appointment: {} }],
    } as never);
    await expect(
      rescheduleAppointment({
        id: appointmentId,
        startsAt: new Date(futureStart().getTime() + 60 * 60 * 1000),
        durationMinutes: 30,
        therapistIds: ['therapist-2'],
        roomId: null,
        overrideConflicts: true,
      } as Parameters<typeof rescheduleAppointment>[0]),
    ).resolves.toBeDefined();
  });
});

describe('appointment resize — duration-only, full conflict engine (PT-B2 §5.2)', () => {
  const auditLogs = (__state as unknown as { auditLogs: Array<Record<string, unknown>> }).auditLogs;
  const startOf = (id: string) => __state.appointments.find((a) => a.id === id)!.startsAt as Date;

  it('changes duration, keeps startsAt, audits RESIZED', async () => {
    const { appointmentId } = await createAppointment(baseCreate);
    const start = startOf(appointmentId);
    auditLogs.length = 0;
    vi.mocked(checkConflicts).mockClear();

    const res = await rescheduleAppointment({
      id: appointmentId,
      startsAt: start, // unchanged — duration-only
      durationMinutes: 60,
      overrideConflicts: false,
      resize: true,
    } as Parameters<typeof rescheduleAppointment>[0]);

    expect(res).toMatchObject({ resized: true });
    const appt = __state.appointments.find((a) => a.id === appointmentId)!;
    expect(appt.durationMinutes).toBe(60);
    expect(appt.startsAt).toEqual(start); // start not moved
    expect(auditLogs.at(-1)).toMatchObject({ after: { event: 'APPOINTMENT_RESIZED' } });
  });

  it('is rejected by a therapist overlap, exactly like a drop (PT-B2 §5.2)', async () => {
    // "Free resize" is withdrawn by owner ruling: stretching the end of an
    // appointment over a colleague's slot double-books just as moving it does,
    // so the resize path now enforces the whole engine.
    const { appointmentId } = await createAppointment(baseCreate);
    const start = startOf(appointmentId);
    const before = __state.appointments.find((a) => a.id === appointmentId)!.durationMinutes;
    vi.mocked(checkConflicts).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'THERAPIST_OVERLAP', therapist: {}, appointment: {} }],
    } as never);
    await expect(
      rescheduleAppointment({
        id: appointmentId,
        startsAt: start,
        durationMinutes: 90,
        overrideConflicts: false,
        resize: true,
      } as Parameters<typeof rescheduleAppointment>[0]),
    ).rejects.toMatchObject({ error: { code: 'APPOINTMENT_CONFLICT' } });
    expect(__state.appointments.find((a) => a.id === appointmentId)!.durationMinutes).toBe(before);
  });

  it('is BLOCKED when it stretches over the same patient’s next booking', async () => {
    // PT-B1 item 3: the same patient can never hold two overlapping slots, and
    // dragging the bottom edge is a way to create one — so the engine runs.
    const { appointmentId } = await createAppointment(baseCreate);
    const start = startOf(appointmentId);
    const clashAt = new Date(start.getTime() + 60 * 60 * 1000);
    vi.mocked(checkConflicts).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'PATIENT_OVERLAP', appointment: { startsAt: clashAt } }],
    } as never);

    await expect(
      rescheduleAppointment({
        id: appointmentId,
        startsAt: start,
        durationMinutes: 180,
        overrideConflicts: true, // the override flag does not help either
        resize: true,
      } as Parameters<typeof rescheduleAppointment>[0]),
    ).rejects.toMatchObject({ error: { code: 'APPOINTMENT_SAME_PATIENT_OVERLAP' } });
    expect(__state.appointments.find((a) => a.id === appointmentId)!.durationMinutes).toBe(30);
  });

  it('clamps a sub-floor resize up to the 15-min grid minimum', async () => {
    const { appointmentId } = await createAppointment(baseCreate);
    await rescheduleAppointment({
      id: appointmentId,
      startsAt: startOf(appointmentId),
      durationMinutes: 5,
      overrideConflicts: false,
      resize: true,
    } as Parameters<typeof rescheduleAppointment>[0]);
    expect(__state.appointments.find((a) => a.id === appointmentId)!.durationMinutes).toBe(15);
  });

  it('REGRESSION: a non-resize reschedule STILL blocks on a conflict', async () => {
    const { appointmentId } = await createAppointment(baseCreate);
    vi.mocked(checkConflicts).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'THERAPIST_OVERLAP', therapist: {}, appointment: {} }],
    } as never);
    await expect(
      rescheduleAppointment({
        id: appointmentId,
        startsAt: new Date(futureStart().getTime() + 60 * 60 * 1000),
        durationMinutes: 30,
        roomId: null,
        overrideConflicts: false,
        resize: false,
      } as Parameters<typeof rescheduleAppointment>[0]),
    ).rejects.toBeDefined();
  });
});

describe('same-patient overlap on CREATE — R-22 hard block (Prompt 42)', () => {
  it('rejects even with overrideConflicts=true, naming the clashing time', async () => {
    const clashAt = futureStart();
    vi.mocked(checkConflicts).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'PATIENT_OVERLAP', appointment: { startsAt: clashAt } }],
    } as never);
    await expect(
      createAppointment({ ...baseCreate, overrideConflicts: true }),
    ).rejects.toMatchObject({ error: { code: 'APPOINTMENT_SAME_PATIENT_OVERLAP' } });
    expect(__state.appointments).toHaveLength(0);
  });

  it('soft conflicts (therapist overlap) remain overridable — semantics untouched', async () => {
    vi.mocked(checkConflicts).mockResolvedValueOnce({
      ok: false,
      conflicts: [{ kind: 'THERAPIST_OVERLAP', therapist: {}, appointment: {} }],
    } as never);
    const r = await createAppointment({ ...baseCreate, overrideConflicts: true });
    expect(r.conflictsOverridden).toBe(true);
    expect(__state.appointments).toHaveLength(1);
  });
});
