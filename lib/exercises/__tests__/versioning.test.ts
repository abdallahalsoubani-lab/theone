import { AuditAction } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = {
    exercises: [] as Array<{
      id: string;
      nameEn: string;
      nameAr: string;
      category: string;
      anatomicalRegion: string;
      descriptionEn: string;
      descriptionAr: string;
      contraindications: string | null;
      defaultInstructionEn: string | null;
      defaultInstructionAr: string | null;
      videoUrl: string | null;
      videoMimeType: string | null;
      videoSizeBytes: number | null;
      imageUrl: string | null;
      imageMimeType: string | null;
      imageSizeBytes: number | null;
      version: number;
      replacedById: string | null;
      active: boolean;
      createdById: string;
      createdAt: Date;
      updatedAt: Date;
    }>,
    auditLogs: [] as Array<Record<string, unknown>>,
    counter: 0,
  };
  return {
    __state: state,
    db: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          exercise: {
            create: vi.fn(
              async ({
                data,
                select,
              }: {
                data: Record<string, unknown>;
                select?: { id: true };
              }) => {
                state.counter += 1;
                const id = `ex-${state.counter}`;
                const row = {
                  id,
                  nameEn: (data.nameEn as string) ?? '',
                  nameAr: (data.nameAr as string) ?? '',
                  category: (data.category as string) ?? 'STRETCHING',
                  anatomicalRegion: (data.anatomicalRegion as string) ?? 'SHOULDER',
                  descriptionEn: (data.descriptionEn as string) ?? '',
                  descriptionAr: (data.descriptionAr as string) ?? '',
                  contraindications: (data.contraindications as string | null) ?? null,
                  defaultInstructionEn: (data.defaultInstructionEn as string | null) ?? null,
                  defaultInstructionAr: (data.defaultInstructionAr as string | null) ?? null,
                  videoUrl: (data.videoUrl as string | null) ?? null,
                  videoMimeType: (data.videoMimeType as string | null) ?? null,
                  videoSizeBytes: (data.videoSizeBytes as number | null) ?? null,
                  imageUrl: (data.imageUrl as string | null) ?? null,
                  imageMimeType: (data.imageMimeType as string | null) ?? null,
                  imageSizeBytes: (data.imageSizeBytes as number | null) ?? null,
                  version: (data.version as number) ?? 1,
                  replacedById: null,
                  active: true,
                  createdById: (data.createdById as string) ?? 'actor',
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };
                state.exercises.push(row);
                return select?.id ? { id } : row;
              },
            ),
            update: vi.fn(
              async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
                const e = state.exercises.find((x) => x.id === where.id)!;
                Object.assign(e, data);
                return e;
              },
            ),
          },
        }),
      ),
      exercise: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.exercises.find((e) => e.id === where.id) ?? null,
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const e = state.exercises.find((x) => x.id === where.id)!;
            Object.assign(e, data);
            return e;
          },
        ),
        create: vi.fn(
          async ({ data, select }: { data: Record<string, unknown>; select?: { id: true } }) => {
            state.counter += 1;
            const id = `ex-${state.counter}`;
            const row = {
              id,
              nameEn: (data.nameEn as string) ?? '',
              nameAr: (data.nameAr as string) ?? '',
              category: (data.category as string) ?? 'STRETCHING',
              anatomicalRegion: (data.anatomicalRegion as string) ?? 'SHOULDER',
              descriptionEn: (data.descriptionEn as string) ?? '',
              descriptionAr: (data.descriptionAr as string) ?? '',
              contraindications: (data.contraindications as string | null) ?? null,
              defaultInstructionEn: (data.defaultInstructionEn as string | null) ?? null,
              defaultInstructionAr: (data.defaultInstructionAr as string | null) ?? null,
              videoUrl: (data.videoUrl as string | null) ?? null,
              videoMimeType: (data.videoMimeType as string | null) ?? null,
              videoSizeBytes: (data.videoSizeBytes as number | null) ?? null,
              imageUrl: (data.imageUrl as string | null) ?? null,
              imageMimeType: (data.imageMimeType as string | null) ?? null,
              imageSizeBytes: (data.imageSizeBytes as number | null) ?? null,
              version: (data.version as number) ?? 1,
              replacedById: null,
              active: true,
              createdById: (data.createdById as string) ?? 'actor',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            state.exercises.push(row);
            return select?.id ? { id } : row;
          },
        ),
        findMany: vi.fn(async () => state.exercises.slice()),
        count: vi.fn(async () => state.exercises.length),
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

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'actor', role: 'THERAPIST' } })),
}));

import * as dbModule from '@/lib/db';
import { archiveExercise, createExercise, ExerciseError, updateExercise } from '../services';

const state = (
  dbModule as unknown as {
    __state: {
      exercises: Array<{
        id: string;
        version: number;
        replacedById: string | null;
        active: boolean;
      }>;
      auditLogs: Array<Record<string, unknown>>;
      counter: number;
    };
  }
).__state;

beforeEach(() => {
  state.exercises.length = 0;
  state.auditLogs.length = 0;
  state.counter = 0;
});

const baseInput = {
  nameEn: 'Wall pushup',
  nameAr: 'تمرين الضغط على الحائط',
  category: 'STRENGTH',
  anatomicalRegion: 'SHOULDER',
  descriptionEn: 'Stand facing a wall and push gently.',
  descriptionAr: 'قف مواجهاً الحائط وادفع بلطف.',
  contraindications: null,
  defaultInstructionEn: null,
  defaultInstructionAr: null,
  videoUrl: null,
  videoMimeType: null,
  videoSizeBytes: null,
  imageUrl: null,
  imageMimeType: null,
  imageSizeBytes: null,
};

describe('createExercise', () => {
  it('inserts a row at version 1 with replacedById null', async () => {
    const r = await createExercise(baseInput, { actorId: 'actor' });
    expect(state.exercises).toHaveLength(1);
    expect(state.exercises[0]).toMatchObject({
      id: r.exerciseId,
      version: 1,
      replacedById: null,
      active: true,
    });
    expect(
      state.auditLogs.find((a) => a.entityType === 'Exercise' && a.action === AuditAction.CREATE),
    ).toBeDefined();
  });
});

describe('updateExercise — versioning', () => {
  it('inserts a NEW row with version+1 and sets the old row.replacedById', async () => {
    const first = await createExercise(baseInput, { actorId: 'actor' });
    const second = await updateExercise(
      { id: first.exerciseId, ...baseInput, nameEn: 'Wall pushup (revised)' },
      { actorId: 'actor' },
    );
    expect(state.exercises).toHaveLength(2);
    const oldRow = state.exercises.find((e) => e.id === first.exerciseId)!;
    const newRow = state.exercises.find((e) => e.id === second.exerciseId)!;
    expect(oldRow.replacedById).toBe(newRow.id);
    expect(newRow.version).toBe(2);
    expect(newRow.replacedById).toBeNull();
  });

  it('refuses to edit a row that has already been superseded (EXERCISE_SUPERSEDED)', async () => {
    const first = await createExercise(baseInput, { actorId: 'actor' });
    await updateExercise(
      { id: first.exerciseId, ...baseInput, nameEn: 'v2' },
      { actorId: 'actor' },
    );
    await expect(
      updateExercise(
        { id: first.exerciseId, ...baseInput, nameEn: 'v3 — but from the wrong row' },
        { actorId: 'actor' },
      ),
    ).rejects.toBeInstanceOf(ExerciseError);
  });

  it('the active library list (replacedById IS NULL) is exactly one row after 3 versions', async () => {
    const first = await createExercise(baseInput, { actorId: 'actor' });
    const second = await updateExercise(
      { id: first.exerciseId, ...baseInput, nameEn: 'v2' },
      { actorId: 'actor' },
    );
    const third = await updateExercise(
      { id: second.exerciseId, ...baseInput, nameEn: 'v3' },
      { actorId: 'actor' },
    );
    const currentRows = state.exercises.filter((e) => e.replacedById === null);
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]!.id).toBe(third.exerciseId);
    expect(currentRows[0]!.version).toBe(3);
  });
});

describe('archiveExercise', () => {
  it('refuses for non-Admin actors', async () => {
    const first = await createExercise(baseInput, { actorId: 'actor' });
    // Auth mock returns THERAPIST role; archive should reject.
    await expect(
      archiveExercise({ id: first.exerciseId }, { actorId: 'actor' }),
    ).rejects.toBeInstanceOf(ExerciseError);
  });
});
