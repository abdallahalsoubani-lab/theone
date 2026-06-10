'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { AUTH_ERRORS, type Result } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';
import { isClinicianAssignedTo } from '@/lib/patients/assignment';
import { requirePermission } from '@/lib/rbac/guards';

import {
  approveHomeProgram,
  homeProgramApprovalToLocalized,
  requestHomeProgramChanges,
  setHomeProgramReminders,
  submitHomeProgram,
} from './approval';
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

// ─── Approval workflow (Prompt 16) ──────────────────────────────────────────

const forbidden: LocalizedError = AUTH_ERRORS.FORBIDDEN;

/** A reviewer must be an Admin or a DOCTOR on the patient's care team. */
async function isCareTeamReviewer(patientId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  if (session.user.role === 'ADMIN') return true;
  if (session.user.role === 'DOCTOR') return isClinicianAssignedTo(session.user.id, patientId);
  return false;
}

function approvalError(err: unknown): LocalizedError {
  return homeProgramApprovalToLocalized(err) ?? homeProgramToLocalized(err);
}

function revalidateProgram(patientId: string): void {
  revalidatePath(`/therapist/patients/${patientId}/home-program/edit`);
  revalidatePath(`/therapist/patients/${patientId}`);
  revalidatePath(`/doctor/patients/${patientId}`);
  revalidatePath('/doctor/approvals');
  revalidatePath('/patient/home-program');
}

export async function submitHomeProgramAction(
  patientId: string,
): Promise<Result<{ patientId: string }, LocalizedError>> {
  await requirePermission('home_program.submit');
  const session = await auth();
  // The submitting therapist must be on the patient's care team.
  if (!session?.user?.id || !(await isClinicianAssignedTo(session.user.id, patientId))) {
    return { ok: false, error: forbidden };
  }
  try {
    await submitHomeProgram(patientId);
    revalidateProgram(patientId);
    return { ok: true, data: { patientId } };
  } catch (err) {
    return { ok: false, error: approvalError(err) };
  }
}

export async function approveHomeProgramAction(
  patientId: string,
): Promise<Result<{ patientId: string }, LocalizedError>> {
  await requirePermission('home_program.approve');
  if (!(await isCareTeamReviewer(patientId))) return { ok: false, error: forbidden };
  try {
    await approveHomeProgram(patientId);
    revalidateProgram(patientId);
    return { ok: true, data: { patientId } };
  } catch (err) {
    return { ok: false, error: approvalError(err) };
  }
}

export async function requestHomeProgramChangesAction(
  patientId: string,
  comment: string,
): Promise<Result<{ patientId: string }, LocalizedError>> {
  await requirePermission('home_program.request_changes');
  if (!(await isCareTeamReviewer(patientId))) return { ok: false, error: forbidden };
  try {
    await requestHomeProgramChanges(patientId, comment);
    revalidateProgram(patientId);
    return { ok: true, data: { patientId } };
  } catch (err) {
    return { ok: false, error: approvalError(err) };
  }
}

export async function setHomeProgramRemindersAction(
  patientId: string,
  enabled: boolean,
): Promise<Result<{ patientId: string; remindersEnabled: boolean }, LocalizedError>> {
  await requirePermission('home_program.update');
  try {
    const data = await setHomeProgramReminders(patientId, enabled);
    revalidateProgram(patientId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: approvalError(err) };
  }
}
