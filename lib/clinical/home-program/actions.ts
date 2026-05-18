'use server';

import { revalidatePath } from 'next/cache';

import type { Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import {
  homeProgramItemCreateSchema,
  homeProgramItemSetActiveSchema,
  homeProgramItemUpdateSchema,
  markCompleteSchema,
} from './schemas';
import {
  addHomeProgramItem,
  currentClinicianId,
  currentPatientId,
  deleteHomeProgramItem,
  homeProgramToLocalized,
  markHomeExerciseDone,
  setHomeProgramItemActive,
  updateHomeProgramItem,
} from './services';

export async function addHomeProgramItemAction(
  raw: unknown,
): Promise<Result<{ itemId: string }, LocalizedError>> {
  await requirePermission('home_program.create');
  const parsed = homeProgramItemCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid input.',
        message_ar: 'بيانات غير صالحة.',
      },
    };
  }
  try {
    const actorId = await currentClinicianId();
    const data = await addHomeProgramItem(parsed.data, { actorId });
    revalidatePath(`/therapist/patients/${parsed.data.patientId}`);
    revalidatePath(`/doctor/patients/${parsed.data.patientId}`);
    revalidatePath(`/secretary/patients/${parsed.data.patientId}`);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: homeProgramToLocalized(err) };
  }
}

export async function updateHomeProgramItemAction(
  raw: unknown,
): Promise<Result<{ itemId: string }, LocalizedError>> {
  await requirePermission('home_program.update');
  const parsed = homeProgramItemUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: parsed.error.issues[0]?.message ?? 'Invalid input.',
        message_ar: 'بيانات غير صالحة.',
      },
    };
  }
  try {
    const actorId = await currentClinicianId();
    const data = await updateHomeProgramItem(parsed.data, { actorId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: homeProgramToLocalized(err) };
  }
}

export async function setHomeProgramItemActiveAction(
  raw: unknown,
): Promise<Result<{ itemId: string }, LocalizedError>> {
  await requirePermission('home_program.update');
  const parsed = homeProgramItemSetActiveSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: 'Invalid input.',
        message_ar: 'بيانات غير صالحة.',
      },
    };
  }
  try {
    const actorId = await currentClinicianId();
    const result = await setHomeProgramItemActive(parsed.data, { actorId });
    return { ok: true, data: { itemId: result.itemId } };
  } catch (err) {
    return { ok: false, error: homeProgramToLocalized(err) };
  }
}

export async function deleteHomeProgramItemAction(
  id: string,
): Promise<Result<{ itemId: string }, LocalizedError>> {
  await requirePermission('home_program.delete');
  try {
    const actorId = await currentClinicianId();
    const data = await deleteHomeProgramItem({ id }, { actorId });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: homeProgramToLocalized(err) };
  }
}

export async function markHomeExerciseDoneAction(
  raw: unknown,
): Promise<Result<{ completionId: string }, LocalizedError>> {
  await requirePermission('home_program.complete.own', {});
  const parsed = markCompleteSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION',
        message_en: 'Invalid input.',
        message_ar: 'بيانات غير صالحة.',
      },
    };
  }
  try {
    const patientId = await currentPatientId();
    const data = await markHomeExerciseDone(parsed.data, { patientId });
    revalidatePath('/patient/home-program');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: homeProgramToLocalized(err) };
  }
}
