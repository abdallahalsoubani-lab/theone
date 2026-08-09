'use server';

import { revalidatePath } from 'next/cache';

import type { Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { exerciseCreateSchema, exerciseUpdateSchema } from './schemas';
import { exerciseValidationMessage } from './validation-message';
import {
  archiveExercise,
  createExercise,
  currentClinicianId,
  exerciseToLocalized,
  restoreExercise,
  updateExercise,
} from './services';

export async function createExerciseAction(
  raw: unknown,
): Promise<Result<{ exerciseId: string }, LocalizedError>> {
  await requirePermission('exercises.create');
  const parsed = exerciseCreateSchema.safeParse(raw);
  if (!parsed.success) {
    // Name the field, and say so in Arabic too — a flat "invalid data"
    // sentence is what made the media failure unreadable (PT-B5 item 1).
    return { ok: false, error: exerciseValidationMessage(parsed.error) };
  }
  try {
    const actorId = await currentClinicianId();
    const data = await createExercise(parsed.data, { actorId });
    revalidatePath('/clinical/exercises');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: exerciseToLocalized(err) };
  }
}

export async function updateExerciseAction(
  raw: unknown,
): Promise<Result<{ exerciseId: string }, LocalizedError>> {
  await requirePermission('exercises.update');
  const parsed = exerciseUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    // Name the field, and say so in Arabic too — a flat "invalid data"
    // sentence is what made the media failure unreadable (PT-B5 item 1).
    return { ok: false, error: exerciseValidationMessage(parsed.error) };
  }
  try {
    const actorId = await currentClinicianId();
    const data = await updateExercise(parsed.data, { actorId });
    revalidatePath('/clinical/exercises');
    revalidatePath(`/clinical/exercises/${parsed.data.id}`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: exerciseToLocalized(err) };
  }
}

export async function archiveExerciseAction(
  id: string,
): Promise<Result<{ exerciseId: string }, LocalizedError>> {
  await requirePermission('exercises.archive');
  try {
    const actorId = await currentClinicianId();
    const data = await archiveExercise({ id }, { actorId });
    revalidatePath('/clinical/exercises');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: exerciseToLocalized(err) };
  }
}

export async function restoreExerciseAction(
  id: string,
): Promise<Result<{ exerciseId: string }, LocalizedError>> {
  await requirePermission('exercises.archive');
  try {
    const actorId = await currentClinicianId();
    const data = await restoreExercise({ id }, { actorId });
    revalidatePath('/clinical/exercises');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: exerciseToLocalized(err) };
  }
}
