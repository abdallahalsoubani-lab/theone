import { AuditAction, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import type { ExerciseCreateInput, ExerciseUpdateInput } from './schemas';

/**
 * Exercise Library services (Prompt 10 §4.3).
 *
 * Three audited mutations:
 *   - createExercise: insert a fresh row at version 1, replacedById null.
 *   - updateExercise: insert a NEW row with version+1; set the old row's
 *     replacedById to the new id. Old version becomes invisible in the
 *     active library list but stays referenced by existing
 *     HomeProgramItems / PlanExercises (the FK has no cascade).
 *   - archiveExercise: flips active=false on the current version. New
 *     home programs can no longer pick it; existing references unaffected.
 *
 * The versioning model is a clinical safety feature: a patient on a
 * 6-week program who got "Wall pushups v1" continues seeing exactly that
 * exercise even after a therapist edits the canonical entry to v2.
 */

export class ExerciseError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'ExerciseError';
  }
}

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};
const notFound: LocalizedError = {
  code: 'EXERCISE_NOT_FOUND',
  message_en: 'Exercise not found.',
  message_ar: 'لم يتم العثور على التمرين.',
};
const supersededAlready: LocalizedError = {
  code: 'EXERCISE_SUPERSEDED',
  message_en:
    'This exercise has already been replaced by a newer version. Edit the current version instead.',
  message_ar: 'تم استبدال هذا التمرين بإصدار أحدث. عدّل الإصدار الحالي بدلاً منه.',
};
const forbiddenArchive: LocalizedError = {
  code: 'EXERCISE_ARCHIVE_FORBIDDEN',
  message_en: 'Only an administrator can archive exercises.',
  message_ar: 'يستطيع المسؤولون فقط أرشفة التمارين.',
};

export const createExercise = withAudit<
  [ExerciseCreateInput, { actorId: string }],
  { exerciseId: string }
>(
  {
    entityType: 'Exercise',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.exerciseId,
    extractAfter: () => ({ event: 'CREATED' }) as Prisma.InputJsonValue,
  },
  async function createInner(input, ctx): Promise<{ exerciseId: string }> {
    const row = await db.exercise.create({
      data: {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        category: input.category,
        anatomicalRegion: input.anatomicalRegion,
        descriptionEn: input.descriptionEn,
        descriptionAr: input.descriptionAr,
        contraindications: input.contraindications ?? null,
        defaultInstructionEn: input.defaultInstructionEn ?? null,
        defaultInstructionAr: input.defaultInstructionAr ?? null,
        videoUrl: input.videoUrl ?? null,
        videoMimeType: input.videoMimeType ?? null,
        videoSizeBytes: input.videoSizeBytes ?? null,
        imageUrl: input.imageUrl ?? null,
        imageMimeType: input.imageMimeType ?? null,
        imageSizeBytes: input.imageSizeBytes ?? null,
        version: 1,
        createdById: ctx.actorId,
      },
      select: { id: true },
    });
    return { exerciseId: row.id };
  },
);

export const updateExercise = withAudit<
  [ExerciseUpdateInput, { actorId: string }],
  { exerciseId: string }
>(
  {
    entityType: 'Exercise',
    action: AuditAction.UPDATE,
    extractEntityId: (_args, result) => result.exerciseId,
    extractAfter: () => ({ event: 'VERSION_BUMP' }) as Prisma.InputJsonValue,
  },
  async function updateInner(input, ctx): Promise<{ exerciseId: string }> {
    const current = await db.exercise.findUnique({
      where: { id: input.id },
      select: { id: true, replacedById: true, version: true },
    });
    if (!current) throw new ExerciseError(notFound);
    if (current.replacedById) throw new ExerciseError(supersededAlready);

    const result = await db.$transaction(async (tx) => {
      const created = await tx.exercise.create({
        data: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          category: input.category,
          anatomicalRegion: input.anatomicalRegion,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          contraindications: input.contraindications ?? null,
          defaultInstructionEn: input.defaultInstructionEn ?? null,
          defaultInstructionAr: input.defaultInstructionAr ?? null,
          videoUrl: input.videoUrl ?? null,
          videoMimeType: input.videoMimeType ?? null,
          videoSizeBytes: input.videoSizeBytes ?? null,
          imageUrl: input.imageUrl ?? null,
          imageMimeType: input.imageMimeType ?? null,
          imageSizeBytes: input.imageSizeBytes ?? null,
          version: current.version + 1,
          createdById: ctx.actorId,
        },
        select: { id: true },
      });
      await tx.exercise.update({
        where: { id: current.id },
        data: { replacedById: created.id },
      });
      return created;
    });
    return { exerciseId: result.id };
  },
);

export const archiveExercise = withAudit<
  [{ id: string }, { actorId: string }],
  { exerciseId: string }
>(
  {
    entityType: 'Exercise',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'ARCHIVED' }) as Prisma.InputJsonValue,
  },
  async function archiveInner({ id }, _ctx): Promise<{ exerciseId: string }> {
    const session = await auth();
    if (!session?.user) throw new ExerciseError(unauthenticated);
    if (session.user.role !== UserRole.ADMIN) throw new ExerciseError(forbiddenArchive);
    const current = await db.exercise.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!current) throw new ExerciseError(notFound);
    await db.exercise.update({ where: { id }, data: { active: false } });
    return { exerciseId: id };
  },
);

export const restoreExercise = withAudit<
  [{ id: string }, { actorId: string }],
  { exerciseId: string }
>(
  {
    entityType: 'Exercise',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'RESTORED' }) as Prisma.InputJsonValue,
  },
  async function restoreInner({ id }, _ctx): Promise<{ exerciseId: string }> {
    const session = await auth();
    if (!session?.user) throw new ExerciseError(unauthenticated);
    if (session.user.role !== UserRole.ADMIN) throw new ExerciseError(forbiddenArchive);
    await db.exercise.update({ where: { id }, data: { active: true } });
    return { exerciseId: id };
  },
);

export function exerciseToLocalized(err: unknown): LocalizedError {
  if (err instanceof ExerciseError) return err.error;
  return toLocalizedError(err);
}

export async function currentClinicianId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new ExerciseError(unauthenticated);
  if (
    session.user.role !== UserRole.DOCTOR &&
    session.user.role !== UserRole.THERAPIST &&
    session.user.role !== UserRole.ADMIN
  ) {
    throw new ExerciseError({
      code: 'FORBIDDEN',
      message_en: 'Only clinical staff can manage exercises.',
      message_ar: 'يمكن للطاقم السريري فقط إدارة التمارين.',
    });
  }
  return session.user.id;
}
