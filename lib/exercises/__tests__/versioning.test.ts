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
        // Supports the duplicate-name guard (Prompt 36): active current rows,
        // optional id exclusion, case-insensitive equals on either name.
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: {
              active: boolean;
              replacedById: null;
              id?: { not: string };
              OR: Array<
                | { nameEn: { equals: string; mode: string } }
                | { nameAr: { equals: string; mode: string } }
              >;
            };
          }) => {
            const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
            return (
              state.exercises.find(
                (e) =>
                  e.active === where.active &&
                  e.replacedById === null &&
                  (!where.id?.not || e.id !== where.id.not) &&
                  where.OR.some((clause) =>
                    'nameEn' in clause
                      ? eq(e.nameEn, clause.nameEn.equals)
                      : eq(e.nameAr, clause.nameAr.equals),
                  ),
              ) ?? null
            );
          },
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

describe('duplicate-name guard (Prompt 36 — D-23 note)', () => {
  it('rejects a new exercise whose EN name matches an active one (case-insensitive, trimmed)', async () => {
    await createExercise(baseInput, { actorId: 'actor' });
    await expect(
      createExercise(
        { ...baseInput, nameEn: '  wall PUSHUP ', nameAr: 'اسم عربي مختلف تماماً' },
        { actorId: 'actor' },
      ),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(ExerciseError);
      expect((e as ExerciseError).error.code).toBe('EXERCISE_NAME_TAKEN');
      return true;
    });
  });

  it('rejects a clash on the ARABIC name too', async () => {
    await createExercise(baseInput, { actorId: 'actor' });
    await expect(
      createExercise(
        { ...baseInput, nameEn: 'Totally different', nameAr: baseInput.nameAr },
        { actorId: 'actor' },
      ),
    ).rejects.toBeInstanceOf(ExerciseError);
  });

  it('a version chain legitimately KEEPS its name (edit is not a duplicate)', async () => {
    const v1 = await createExercise(baseInput, { actorId: 'actor' });
    const v2 = await updateExercise({ ...baseInput, id: v1.exerciseId }, { actorId: 'actor' });
    expect(v2.exerciseId).not.toBe(v1.exerciseId); // new row, same name — allowed
  });

  it('renaming (via edit) onto ANOTHER active exercise name is blocked', async () => {
    await createExercise(baseInput, { actorId: 'actor' });
    const other = await createExercise(
      { ...baseInput, nameEn: 'Bridge', nameAr: 'الجسر' },
      { actorId: 'actor' },
    );
    await expect(
      updateExercise(
        { ...baseInput, id: other.exerciseId, nameEn: 'Wall pushup', nameAr: 'الجسر' },
        { actorId: 'actor' },
      ),
    ).rejects.toSatisfy((e: unknown) => {
      expect((e as ExerciseError).error.code).toBe('EXERCISE_NAME_TAKEN');
      return true;
    });
  });

  it('archiving does NOT free the name for a brand-new exercise (PT-B5 item 2)', async () => {
    // Reversed from the original rule. Reusing an archived exercise's name is
    // exactly the confusion the clinic reported: two rows, one name, nothing
    // on screen telling them apart.
    const first = await createExercise(baseInput, { actorId: 'actor' });
    // Flip active=false directly (the archive service enforces Admin via auth,
    // whose mock returns THERAPIST here — the guard itself is what we test).
    state.exercises.find((e) => e.id === first.exerciseId)!.active = false;
    await expect(createExercise(baseInput, { actorId: 'actor' })).rejects.toMatchObject({
      error: { code: 'EXERCISE_NAME_TAKEN' },
    });
  });

  it('a superseded name is not free for a new exercise either', async () => {
    const first = await createExercise(baseInput, { actorId: 'actor' });
    // v2 takes over the name; v1 is now superseded.
    await updateExercise({ id: first.exerciseId, ...baseInput }, { actorId: 'actor' });
    await expect(createExercise(baseInput, { actorId: 'actor' })).rejects.toMatchObject({
      error: { code: 'EXERCISE_NAME_TAKEN' },
    });
  });

  describe('normalized matching (PT-B5 item 2)', () => {
    it('folds Arabic alif variants — the same exercise typed two ways', async () => {
      await createExercise(
        { ...baseInput, nameEn: 'Shoulder stretch', nameAr: 'تمرين الإطالة' },
        { actorId: 'actor' },
      );
      await expect(
        createExercise(
          { ...baseInput, nameEn: 'Something else entirely', nameAr: 'تمرين الاطالة' },
          { actorId: 'actor' },
        ),
      ).rejects.toMatchObject({ error: { code: 'EXERCISE_NAME_TAKEN' } });
    });

    it('collapses internal whitespace — "Wall  pushup" is not a second exercise', async () => {
      await createExercise(baseInput, { actorId: 'actor' });
      await expect(
        createExercise({ ...baseInput, nameEn: 'Wall   pushup' }, { actorId: 'actor' }),
      ).rejects.toMatchObject({ error: { code: 'EXERCISE_NAME_TAKEN' } });
    });

    it('still allows a genuinely different name', async () => {
      await createExercise(baseInput, { actorId: 'actor' });
      await expect(
        createExercise(
          { ...baseInput, nameEn: 'Doorway chest stretch', nameAr: 'إطالة الصدر' },
          { actorId: 'actor' },
        ),
      ).resolves.toMatchObject({ exerciseId: expect.any(String) });
    });
  });
});
