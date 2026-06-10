import { AuditAction } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the BullMQ reminder helpers so tests don't try to talk to Redis.
vi.mock('@/lib/queue/jobs/homeExerciseReminder', () => ({
  registerHomeReminderJob: vi.fn(async () => 'fake-repeat-key'),
  removeHomeReminderJob: vi.fn(async () => undefined),
}));

vi.mock('@/lib/env', () => ({
  env: { HOME_REMINDER_OFFSET_MINUTES: 30 },
}));

vi.mock('@/lib/db', () => {
  const state = {
    items: [] as Array<{
      id: string;
      patientId: string;
      exerciseId: string;
      daysOfWeek: number[];
      scheduledTime: string;
      durationMinutes: number;
      setsReps: string | null;
      therapistNote: string | null;
      active: boolean;
      reminderJobKey: string | null;
      createdAt: Date;
    }>,
    completions: [] as Array<{
      id: string;
      itemId: string;
      scheduledDate: Date;
      completedAt: Date | null;
      painScore: number | null;
    }>,
    exercises: [
      { id: 'ex-1', active: true, replacedById: null },
      { id: 'ex-archived', active: false, replacedById: null },
    ] as Array<{ id: string; active: boolean; replacedById: string | null }>,
    careTeam: [{ patientId: 'patient-1', clinicianId: 'therapist-1' }] as Array<{
      patientId: string;
      clinicianId: string;
    }>,
    auditLogs: [] as Array<Record<string, unknown>>,
    counter: 0,
  };
  return {
    __state: state,
    db: {
      homeProgramItem: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.items.find((i) => i.id === where.id) ?? null,
        ),
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: true } }) => {
            state.counter += 1;
            const id = `item-${state.counter}`;
            const row = {
              id,
              patientId: data.patientId as string,
              exerciseId: data.exerciseId as string,
              daysOfWeek: data.daysOfWeek as number[],
              scheduledTime: data.scheduledTime as string,
              durationMinutes: data.durationMinutes as number,
              setsReps: (data.setsReps as string | null) ?? null,
              therapistNote: (data.therapistNote as string | null) ?? null,
              active: data.active as boolean,
              reminderJobKey: null,
              createdAt: new Date(),
            };
            state.items.push(row);
            return select?.id ? { id } : row;
          },
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const item = state.items.find((i) => i.id === where.id)!;
            Object.assign(item, data);
            return item;
          },
        ),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          const idx = state.items.findIndex((i) => i.id === where.id);
          if (idx !== -1) state.items.splice(idx, 1);
          return { id: where.id };
        }),
      },
      homeProgramCompletion: {
        upsert: vi.fn(
          async ({
            where,
            create,
            update,
            select,
          }: {
            where: { itemId_scheduledDate: { itemId: string; scheduledDate: Date } };
            create: Record<string, unknown>;
            update: Record<string, unknown>;
            select?: { id: true };
          }) => {
            const existing = state.completions.find(
              (c) =>
                c.itemId === where.itemId_scheduledDate.itemId &&
                c.scheduledDate.getTime() === where.itemId_scheduledDate.scheduledDate.getTime(),
            );
            if (existing) {
              Object.assign(existing, update);
              return select?.id ? { id: existing.id } : existing;
            }
            state.counter += 1;
            const id = `comp-${state.counter}`;
            const row = {
              id,
              itemId: create.itemId as string,
              scheduledDate: create.scheduledDate as Date,
              completedAt: (create.completedAt as Date | null) ?? null,
              painScore: (create.painScore as number | null) ?? null,
            };
            state.completions.push(row);
            return select?.id ? { id } : row;
          },
        ),
      },
      exercise: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.exercises.find((e) => e.id === where.id) ?? null,
        ),
      },
      careTeamMember: {
        findUnique: vi.fn(
          async ({
            where,
          }: {
            where: { patientId_clinicianId: { patientId: string; clinicianId: string } };
          }) => {
            const { patientId, clinicianId } = where.patientId_clinicianId;
            const m = state.careTeam.find(
              (x) => x.patientId === patientId && x.clinicianId === clinicianId,
            );
            return m ? { id: 'ctm-1' } : null;
          },
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
      message_ar: 'خطأ.',
    }),
  };
});

const sessionRef = {
  current: { user: { id: 'therapist-1', role: 'THERAPIST' } } as {
    user: { id: string; role: string };
  } | null,
};
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => sessionRef.current),
}));

import * as dbModule from '@/lib/db';
import { addHomeProgramItem, HomeProgramError, markHomeExerciseDone } from '../services';

const state = (
  dbModule as unknown as {
    __state: {
      items: Array<{ id: string; patientId: string; daysOfWeek: number[]; active: boolean }>;
      completions: Array<{ id: string; itemId: string }>;
      auditLogs: Array<Record<string, unknown>>;
      counter: number;
    };
  }
).__state;

beforeEach(() => {
  state.items.length = 0;
  state.completions.length = 0;
  state.auditLogs.length = 0;
  state.counter = 0;
  sessionRef.current = { user: { id: 'therapist-1', role: 'THERAPIST' } };
});

const validInput = {
  patientId: 'patient-1',
  exerciseId: 'ex-1',
  daysOfWeek: [1, 3, 5],
  scheduledTime: '18:00',
  durationMinutes: 15,
  setsReps: '3 × 10',
  therapistNote: 'Slow and controlled.',
};

describe('addHomeProgramItem', () => {
  it('inserts when the actor is the assigned therapist', async () => {
    const r = await addHomeProgramItem(validInput, { actorId: 'therapist-1' });
    expect(r.itemId).toMatch(/^item-/);
    expect(state.items[0]).toMatchObject({ patientId: 'patient-1', active: true });
    expect(
      state.auditLogs.find(
        (a) => a.entityType === 'HomeProgramItem' && a.action === AuditAction.CREATE,
      ),
    ).toBeDefined();
  });

  it('rejects an archived exercise (EXERCISE_ARCHIVED)', async () => {
    await expect(
      addHomeProgramItem({ ...validInput, exerciseId: 'ex-archived' }, { actorId: 'therapist-1' }),
    ).rejects.toBeInstanceOf(HomeProgramError);
  });

  it("rejects a Therapist who is not the patient's assigned therapist", async () => {
    sessionRef.current = { user: { id: 'therapist-other', role: 'THERAPIST' } };
    await expect(
      addHomeProgramItem(validInput, { actorId: 'therapist-other' }),
    ).rejects.toBeInstanceOf(HomeProgramError);
  });

  it('sorts daysOfWeek ascending on insert', async () => {
    await addHomeProgramItem({ ...validInput, daysOfWeek: [5, 1, 3] }, { actorId: 'therapist-1' });
    expect(state.items[0]!.daysOfWeek).toEqual([1, 3, 5]);
  });
});

describe('markHomeExerciseDone — patient idempotency', () => {
  function setupItem(daysOfWeek: number[]) {
    state.items.push({
      id: 'item-1',
      patientId: 'patient-1',
      daysOfWeek,
      active: true,
    });
  }

  it('inserts a completion when today is in daysOfWeek', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    setupItem([today.getUTCDay()]);
    const r = await markHomeExerciseDone(
      { itemId: 'item-1', painScore: 3 },
      { patientId: 'patient-1' },
    );
    expect(r.completionId).toMatch(/^comp-/);
    expect(state.completions).toHaveLength(1);
  });

  it('is idempotent on a second call the same day (upsert)', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    setupItem([today.getUTCDay()]);
    const a = await markHomeExerciseDone({ itemId: 'item-1' }, { patientId: 'patient-1' });
    const b = await markHomeExerciseDone({ itemId: 'item-1' }, { patientId: 'patient-1' });
    expect(state.completions).toHaveLength(1);
    expect(a.completionId).toBe(b.completionId);
  });

  it('refuses when today is not in daysOfWeek (HOME_PROGRAM_NOT_TODAY)', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dow = today.getUTCDay();
    const notToday = [(dow + 3) % 7]; // pick a definitely-different day
    setupItem(notToday);
    await expect(
      markHomeExerciseDone({ itemId: 'item-1' }, { patientId: 'patient-1' }),
    ).rejects.toBeInstanceOf(HomeProgramError);
  });

  it('refuses when the item belongs to a different patient', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    state.items.push({
      id: 'item-other',
      patientId: 'patient-OTHER',
      daysOfWeek: [today.getUTCDay()],
      active: true,
    });
    await expect(
      markHomeExerciseDone({ itemId: 'item-other' }, { patientId: 'patient-1' }),
    ).rejects.toBeInstanceOf(HomeProgramError);
  });

  it('refuses when the item is paused (active=false)', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    state.items.push({
      id: 'item-paused',
      patientId: 'patient-1',
      daysOfWeek: [today.getUTCDay()],
      active: false,
    });
    await expect(
      markHomeExerciseDone({ itemId: 'item-paused' }, { patientId: 'patient-1' }),
    ).rejects.toBeInstanceOf(HomeProgramError);
  });
});
