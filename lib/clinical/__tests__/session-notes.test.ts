import { AppointmentStatus, AuditAction } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = {
    appointments: [] as Array<{
      id: string;
      patientId: string;
      therapistId: string;
      status: AppointmentStatus;
    }>,
    notes: [] as Array<{
      id: string;
      appointmentId: string;
      patientId: string;
      therapistId: string;
      parentNoteId: string | null;
      subjective: string;
      objective: string;
      assessment: string;
      plan: string;
      painScore: number;
      measurements: unknown;
      createdAt: Date;
    }>,
    auditLogs: [] as Array<Record<string, unknown>>,
    counter: 0,
  };
  return {
    __state: state,
    db: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          sessionNote: {
            create: vi.fn(
              async ({
                data,
                select,
              }: {
                data: Record<string, unknown>;
                select?: { id: true };
              }) => {
                state.counter += 1;
                const id = `note-${state.counter}`;
                const row = {
                  id,
                  appointmentId: data.appointmentId as string,
                  patientId: data.patientId as string,
                  therapistId: data.therapistId as string,
                  parentNoteId: (data.parentNoteId as string | null) ?? null,
                  subjective: (data.subjective as string) ?? '',
                  objective: (data.objective as string) ?? '',
                  assessment: (data.assessment as string) ?? '',
                  plan: (data.plan as string) ?? '',
                  painScore: data.painScore as number,
                  measurements: data.measurements ?? {},
                  createdAt: new Date(),
                };
                state.notes.push(row);
                return select?.id ? { id } : row;
              },
            ),
          },
          appointment: {
            update: vi.fn(
              async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
                const a = state.appointments.find((x) => x.id === where.id)!;
                Object.assign(a, data);
                return a;
              },
            ),
          },
        }),
      ),
      sessionNote: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.notes.find((n) => n.id === where.id) ?? null,
        ),
        findFirst: vi.fn(
          async ({ where }: { where: { appointmentId?: string; parentNoteId?: null } }) =>
            state.notes.find(
              (n) =>
                (where.appointmentId == null || n.appointmentId === where.appointmentId) &&
                (where.parentNoteId !== null || n.parentNoteId === null),
            ) ?? null,
        ),
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: true } }) => {
            state.counter += 1;
            const id = `note-${state.counter}`;
            const row = {
              id,
              appointmentId: data.appointmentId as string,
              patientId: data.patientId as string,
              therapistId: data.therapistId as string,
              parentNoteId: (data.parentNoteId as string | null) ?? null,
              subjective: (data.subjective as string) ?? '',
              objective: (data.objective as string) ?? '',
              assessment: (data.assessment as string) ?? '',
              plan: (data.plan as string) ?? '',
              painScore: data.painScore as number,
              measurements: data.measurements ?? {},
              createdAt: new Date(),
            };
            state.notes.push(row);
            return select?.id ? { id } : row;
          },
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const n = state.notes.find((x) => x.id === where.id)!;
            Object.assign(n, data);
            return n;
          },
        ),
      },
      appointment: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.appointments.find((a) => a.id === where.id) ?? null,
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditLogs.push(data);
          return data;
        }),
      },
    },
    toLocalizedError: (err: unknown) => ({
      code: 'INTERNAL',
      message_en: err instanceof Error ? err.message : String(err),
      message_ar: 'خطأ داخلي.',
    }),
  };
});

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'therapist-1', role: 'THERAPIST' } })),
}));

import * as dbModule from '@/lib/db';
import {
  addSessionNoteAddendum,
  createSessionNote,
  SessionNoteError,
  updateSessionNote,
} from '../session-notes/services';

const state = (
  dbModule as unknown as {
    __state: {
      appointments: Array<{
        id: string;
        patientId: string;
        therapistId: string;
        status: AppointmentStatus;
      }>;
      notes: Array<{
        id: string;
        appointmentId: string;
        patientId: string;
        therapistId: string;
        parentNoteId: string | null;
        createdAt: Date;
      }>;
      auditLogs: Array<Record<string, unknown>>;
      counter: number;
    };
  }
).__state;

beforeEach(() => {
  state.appointments.length = 0;
  state.notes.length = 0;
  state.auditLogs.length = 0;
  state.counter = 0;
  state.appointments.push({
    id: 'appt-1',
    patientId: 'patient-1',
    therapistId: 'therapist-1',
    status: AppointmentStatus.IN_PROGRESS,
  });
});

const baseInput = {
  appointmentId: 'appt-1',
  subjective: 'reports moderate improvement',
  objective: 'ROM improved 10°',
  assessment: 'responding well',
  plan: 'continue + add resistance band',
  painScore: 4,
  measurements: 'shoulder flexion 160°',
};

describe('createSessionNote', () => {
  it('writes a primary note + transitions the appointment to COMPLETED', async () => {
    await createSessionNote(baseInput, { therapistId: 'therapist-1' });
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]!.parentNoteId).toBeNull();
    expect(state.appointments[0]!.status).toBe(AppointmentStatus.COMPLETED);
    expect(state.auditLogs.find((a) => a.action === AuditAction.CREATE)).toBeDefined();
  });

  it('refuses when a primary note already exists (SESSION_NOTE_EXISTS)', async () => {
    state.notes.push({
      id: 'note-existing',
      appointmentId: 'appt-1',
      patientId: 'patient-1',
      therapistId: 'therapist-1',
      parentNoteId: null,
      createdAt: new Date(),
    });
    await expect(
      createSessionNote(baseInput, { therapistId: 'therapist-1' }),
    ).rejects.toBeInstanceOf(SessionNoteError);
  });

  it('refuses when therapist is not the appointment owner', async () => {
    await expect(
      createSessionNote(baseInput, { therapistId: 'therapist-other' }),
    ).rejects.toBeInstanceOf(SessionNoteError);
  });
});

describe('updateSessionNote — 24-hour window', () => {
  it('allows updates within 24 hours', async () => {
    state.notes.push({
      id: 'note-1',
      appointmentId: 'appt-1',
      patientId: 'patient-1',
      therapistId: 'therapist-1',
      parentNoteId: null,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    await updateSessionNote(
      {
        noteId: 'note-1',
        subjective: 'updated',
        objective: '',
        assessment: '',
        plan: '',
        painScore: 5,
        measurements: '',
      },
      { therapistId: 'therapist-1' },
    );
    expect(state.notes[0]!).toMatchObject({ id: 'note-1' });
  });

  it('refuses updates after 24 hours with SESSION_NOTE_IMMUTABLE', async () => {
    state.notes.push({
      id: 'note-old',
      appointmentId: 'appt-1',
      patientId: 'patient-1',
      therapistId: 'therapist-1',
      parentNoteId: null,
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    await expect(
      updateSessionNote(
        {
          noteId: 'note-old',
          subjective: 'late correction',
          objective: '',
          assessment: '',
          plan: '',
          painScore: 5,
          measurements: '',
        },
        { therapistId: 'therapist-1' },
      ),
    ).rejects.toBeInstanceOf(SessionNoteError);
  });

  it('refuses updates by a different therapist', async () => {
    state.notes.push({
      id: 'note-1',
      appointmentId: 'appt-1',
      patientId: 'patient-1',
      therapistId: 'therapist-1',
      parentNoteId: null,
      createdAt: new Date(),
    });
    await expect(
      updateSessionNote(
        {
          noteId: 'note-1',
          subjective: 'sneaky edit',
          objective: '',
          assessment: '',
          plan: '',
          painScore: 5,
          measurements: '',
        },
        { therapistId: 'therapist-other' },
      ),
    ).rejects.toBeInstanceOf(SessionNoteError);
  });
});

describe('addSessionNoteAddendum', () => {
  it('creates a child note pointing at the primary', async () => {
    state.notes.push({
      id: 'note-primary',
      appointmentId: 'appt-1',
      patientId: 'patient-1',
      therapistId: 'therapist-1',
      parentNoteId: null,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    });
    await addSessionNoteAddendum(
      {
        parentNoteId: 'note-primary',
        subjective: 'late clarification',
        objective: '',
        assessment: '',
        plan: '',
        painScore: 4,
        measurements: '',
      },
      { actorId: 'doctor-1' },
    );
    const addendum = state.notes.find((n) => n.parentNoteId === 'note-primary');
    expect(addendum).toBeDefined();
    expect(addendum!.appointmentId).toBe('appt-1');
  });

  it('refuses to chain off another addendum (SESSION_NOTE_ADDENDUM_CHAIN)', async () => {
    state.notes.push(
      {
        id: 'note-primary',
        appointmentId: 'appt-1',
        patientId: 'patient-1',
        therapistId: 'therapist-1',
        parentNoteId: null,
        createdAt: new Date(),
      },
      {
        id: 'note-addendum',
        appointmentId: 'appt-1',
        patientId: 'patient-1',
        therapistId: 'therapist-1',
        parentNoteId: 'note-primary',
        createdAt: new Date(),
      },
    );
    await expect(
      addSessionNoteAddendum(
        {
          parentNoteId: 'note-addendum',
          subjective: 'second-degree addendum',
          objective: '',
          assessment: '',
          plan: '',
          painScore: 4,
          measurements: '',
        },
        { actorId: 'doctor-1' },
      ),
    ).rejects.toBeInstanceOf(SessionNoteError);
  });
});
