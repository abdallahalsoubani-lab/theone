import { AuditAction, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { normalizeName } from '@/lib/text/normalize';

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

const nameTaken: LocalizedError = {
  code: 'EXERCISE_NAME_TAKEN',
  // The message has to point somewhere: whoever hits this usually wants a new
  // VERSION of the exercise that already owns the name, and when the clash is
  // with an archived row the library's archive filter is where it is hiding.
  message_en:
    'That name is already used by another exercise (archived ones included). Open that exercise and save a new version, or pick a different name.',
  message_ar:
    'الاسم مستخدم لتمرين آخر (بما في ذلك المؤرشف). افتح ذلك التمرين وأنشئ نسخة جديدة منه، أو اختر اسماً آخر.',
};

/**
 * Duplicate-name guard (Prompt 36 — D-23; widened in PT-B5 item 2).
 *
 * Matching is NORMALIZED, not merely case-insensitive: trimmed, internal
 * whitespace collapsed, Latin lowercased, and Arabic folded (diacritics and
 * tatweel stripped, alif/yaa/taa-marbuta variants unified). Without the Arabic
 * fold "تمرين الإطالة" and "تمرين الاطالة" were two rows to the database and
 * one exercise to every human reading the list.
 *
 * Scope differs by intent:
 *   - 'all' (CREATE) — a genuinely new exercise may not take ANY existing
 *     name, archived and superseded included. That is the clinic's complaint:
 *     a new exercise reusing an archived name, indistinguishable afterwards.
 *   - 'current' (UPDATE → new version) — only active, un-replaced rows count,
 *     so a version chain keeps its own name (its predecessor is superseded and
 *     no longer competes) while renaming onto a live exercise stays blocked.
 *
 * Normalization cannot be expressed in a Prisma `where`, so the comparison
 * runs in JS over the name columns — one small read at clinic scale (hundreds
 * of exercises, rare writes). The race window is negligible, as before.
 */
async function assertExerciseNameAvailable(
  nameEn: string,
  nameAr: string,
  opts: { scope: 'all' | 'current'; excludeId?: string },
): Promise<void> {
  const rows = await db.exercise.findMany({
    select: { id: true, nameEn: true, nameAr: true, active: true, replacedById: true },
  });
  const wantedEn = normalizeName(nameEn);
  const wantedAr = normalizeName(nameAr);

  const clash = rows.find((row) => {
    if (row.id === opts.excludeId) return false;
    if (opts.scope === 'current' && (!row.active || row.replacedById !== null)) return false;
    return normalizeName(row.nameEn) === wantedEn || normalizeName(row.nameAr) === wantedAr;
  });
  if (clash) throw new ExerciseError(nameTaken);
}

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
    // A brand-new exercise competes with EVERY name ever used, archived rows
    // included — reusing an archived name is the confusion being fixed.
    await assertExerciseNameAvailable(input.nameEn, input.nameAr, { scope: 'all' });
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

    // A new version legitimately keeps its predecessor's name (the old row is
    // excluded and superseded rows don't compete); renaming onto another
    // CURRENT exercise's name is still blocked.
    await assertExerciseNameAvailable(input.nameEn, input.nameAr, {
      scope: 'current',
      excludeId: current.id,
    });

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
