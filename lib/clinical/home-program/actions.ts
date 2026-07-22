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

/**
 * NI-6 sync fix (Prompt 43): the old calls passed concrete URL paths without
 * the locale prefix (`/therapist/patients/x`) which match no real route —
 * silent no-ops. Routes are always `/{locale}/...`, so invalidation must use
 * the route-PATTERN form (same as the appointments module). Every surface
 * that renders program content is listed: both role edit pages, the patient
 * file tabs, the doctor queue, and the patient portal.
 */
function revalidateProgramPages(): void {
  revalidatePath('/[locale]/(staff)/therapist/patients/[id]', 'page');
  revalidatePath('/[locale]/(staff)/therapist/patients/[id]/home-program/edit', 'page');
  revalidatePath('/[locale]/(staff)/doctor/patients/[id]', 'page');
  revalidatePath('/[locale]/(staff)/doctor/patients/[id]/home-program/edit', 'page');
  revalidatePath('/[locale]/(staff)/secretary/patients/[id]', 'page');
  revalidatePath('/[locale]/(admin)/admin/patients/[id]', 'page');
  revalidatePath('/[locale]/(staff)/doctor/approvals', 'page');
  revalidatePath('/[locale]/(patient)/patient/home-program', 'page');
}

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
    revalidateProgramPages();
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
    revalidateProgramPages();
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
    revalidateProgramPages();
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
    revalidateProgramPages();
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
    // Same non-locale-path fix (NI-6, Prompt 43) — plus the clinician tabs
    // that render compliance from these completions.
    revalidatePath('/[locale]/(patient)/patient/home-program', 'page');
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
    revalidateProgramPages();
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
    revalidateProgramPages();
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
    revalidateProgramPages();
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
    revalidateProgramPages();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: approvalError(err) };
  }
}
