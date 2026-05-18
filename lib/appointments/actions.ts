'use server';

import { AppointmentStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { fail, ok, type Result } from '@/lib/auth/result';
import { requirePermission } from '@/lib/rbac/guards';

import { checkConflicts, type ConflictResult } from './conflicts';
import {
  appointmentCancelSchema,
  appointmentChangeTherapistSchema,
  appointmentCreateSchema,
  appointmentRescheduleSchema,
  appointmentStatusSchema,
  type AppointmentCancelInput,
  type AppointmentChangeTherapistInput,
  type AppointmentCreateInput,
  type AppointmentRescheduleInput,
  type AppointmentStatusInput,
} from './schemas';
import {
  appointmentToLocalized,
  cancelAppointment,
  changeAppointmentTherapist,
  createAppointment,
  permissionForStatusChange,
  rescheduleAppointment,
  updateAppointmentStatus,
} from './services';

const revalidate = () => {
  revalidatePath('/[locale]/(staff)/secretary/calendar', 'page');
  revalidatePath('/[locale]/(staff)/therapist/schedule', 'page');
  revalidatePath('/[locale]/(patient)/patient/appointments', 'page');
};

/**
 * Lightweight live-preview endpoint for the create / reschedule modals.
 * Pure-read, no audit, no transactions — safe to call on every keystroke
 * (debounced 300ms client-side).
 */
export async function previewConflictsAction(input: {
  appointmentId?: string;
  patientId: string;
  therapistId: string;
  startsAt: string;
  durationMinutes: number;
}): Promise<Result<ConflictResult>> {
  await requirePermission('appointments.read');
  try {
    const result = await checkConflicts({
      ...input,
      startsAt: new Date(input.startsAt),
    });
    return ok(result);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

export async function createAppointmentAction(
  input: AppointmentCreateInput,
): Promise<Result<{ appointmentId: string; conflictsOverridden: boolean }>> {
  await requirePermission('appointments.create');
  const parsed = appointmentCreateSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  if (parsed.data.overrideConflicts) {
    await requirePermission('appointments.override_conflict');
  }
  try {
    const data = await createAppointment(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

export async function rescheduleAppointmentAction(
  input: AppointmentRescheduleInput,
): Promise<Result<{ appointmentId: string; conflictsOverridden: boolean }>> {
  await requirePermission('appointments.update');
  const parsed = appointmentRescheduleSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  if (parsed.data.overrideConflicts) {
    await requirePermission('appointments.override_conflict');
  }
  try {
    const data = await rescheduleAppointment(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

export async function changeTherapistAction(
  input: AppointmentChangeTherapistInput,
): Promise<Result<{ appointmentId: string; conflictsOverridden: boolean }>> {
  await requirePermission('appointments.update');
  const parsed = appointmentChangeTherapistSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  if (parsed.data.overrideConflicts) {
    await requirePermission('appointments.override_conflict');
  }
  try {
    const data = await changeAppointmentTherapist(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

export async function cancelAppointmentAction(
  input: AppointmentCancelInput,
): Promise<Result<{ appointmentId: string; flaggedShortNotice: boolean }>> {
  await requirePermission('appointments.cancel');
  const parsed = appointmentCancelSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  try {
    const data = await cancelAppointment(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

export async function updateStatusAction(
  input: AppointmentStatusInput,
): Promise<Result<{ appointmentId: string }>> {
  const parsed = appointmentStatusSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));

  // Look up the current status to pick the right permission code.
  const existing = await import('./queries').then((m) => m.getAppointmentById(parsed.data.id));
  if (!existing) return fail(appointmentToLocalized(new Error('not found')));

  const permission = permissionForStatusChange(existing.status, parsed.data.to);
  if (!permission) {
    return fail({
      code: 'APPOINTMENT_INVALID_TRANSITION',
      message_en: 'Invalid status transition.',
      message_ar: 'انتقال حالة غير صالح.',
    });
  }
  await requirePermission(permission);

  // Cancel transitions must go through cancelAppointmentAction (which captures
  // the reason). Reject here to keep audit trails clean.
  if (parsed.data.to === AppointmentStatus.CANCELLED) {
    return fail({
      code: 'CANCEL_VIA_DEDICATED_ACTION',
      message_en: 'Use the cancel action — a reason is required.',
      message_ar: 'استخدم إجراء الإلغاء — السبب مطلوب.',
    });
  }

  try {
    const data = await updateAppointmentStatus(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}
