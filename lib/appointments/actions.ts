'use server';

import { AppointmentStatus, type AppointmentType } from '@prisma/client';
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
  seriesBatchCreateSchema,
  type AppointmentCancelInput,
  type AppointmentChangeTherapistInput,
  type AppointmentCreateInput,
  type AppointmentRescheduleInput,
  type AppointmentStatusInput,
  type SeriesBatchCreateInput,
} from './schemas';
import {
  createNewPatientBooking,
  NewPatientBookingError,
  type NewPatientBookingResult,
} from './new-patient-booking';
import { newPatientBookingSchemaRefined } from './schemas';
import {
  appointmentToLocalized,
  cancelAppointment,
  cancelAppointmentSeries,
  changeAppointmentTherapist,
  createAppointment,
  createSeriesBatch,
  getTherapistAvailabilityForTimeSlot,
  permissionForStatusChange,
  previewSeriesBatch,
  rescheduleAppointment,
  updateAppointmentStatus,
  type BatchRowPreview,
  type TherapistAvailabilityRow,
} from './services';

const revalidate = () => {
  revalidatePath('/[locale]/(staff)/secretary/calendar', 'page');
  revalidatePath('/[locale]/(staff)/therapist/calendar', 'page');
  revalidatePath('/[locale]/(patient)/patient/appointments', 'page');
};

/**
 * Lightweight live-preview endpoint for the create / reschedule modals.
 * Pure-read, no audit, no transactions — safe to call on every keystroke
 * (debounced 300ms client-side).
 */
export async function previewConflictsAction(input: {
  appointmentId?: string;
  patientId?: string | null;
  /** GROUP members (R-22, Prompt 42) — each runs the patient-overlap check. */
  patientIds?: string[];
  therapistIds: string[];
  startsAt: string;
  durationMinutes: number;
  appointmentType?: AppointmentType;
  roomId?: string | null;
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

/**
 * P52 — create a new patient + their single-use intake link + the appointment
 * in one atomic call. Gates on BOTH patients.create and appointments.create
 * (the two permissions the flow exercises). Duplicate phone is surfaced as a
 * localized error whose details carry the existing patient so the modal can
 * offer "use this patient".
 */
export async function createNewPatientBookingAction(
  input: unknown,
): Promise<Result<NewPatientBookingResult>> {
  await requirePermission('patients.create');
  await requirePermission('appointments.create');
  const parsed = newPatientBookingSchemaRefined.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  if (parsed.data.overrideConflicts) {
    await requirePermission('appointments.override_conflict');
  }
  try {
    const data = await createNewPatientBooking(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    if (err instanceof NewPatientBookingError) return fail(err.error);
    return fail(appointmentToLocalized(err));
  }
}

export async function rescheduleAppointmentAction(input: AppointmentRescheduleInput): Promise<
  Result<{
    appointmentId?: string;
    conflictsOverridden: boolean;
  }>
> {
  await requirePermission('appointments.update');
  const parsed = appointmentRescheduleSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  if (parsed.data.overrideConflicts) {
    await requirePermission('appointments.override_conflict');
  }
  try {
    // Prompt 45 rows 1+2 — edits always target the single occurrence. The
    // schema strips any `seriesMode` an old client might still send, so the
    // series fan-out is unreachable from this action.
    const data = await rescheduleAppointment(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

export async function changeTherapistAction(input: AppointmentChangeTherapistInput): Promise<
  Result<{
    appointmentId?: string;
    conflictsOverridden: boolean;
    previousTherapistIds: string[];
    newTherapistIds: string[];
    reason: string | null;
  }>
> {
  await requirePermission('appointments.update');
  const parsed = appointmentChangeTherapistSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  if (parsed.data.overrideConflicts) {
    await requirePermission('appointments.override_conflict');
  }
  try {
    // Prompt 45 rows 1+2 — therapist changes apply to this occurrence only;
    // the series fan-out was removed (see rescheduleAppointmentAction).
    const data = await changeAppointmentTherapist(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

/**
 * Batched availability check for the change-therapist picker. Runs the
 * conflict engine across every candidate therapist in parallel. The
 * result is advisory — the eventual save re-runs the check.
 */
export async function previewTherapistAvailabilityAction(input: {
  appointmentId: string;
  patientId: string;
  startsAt: string;
  durationMinutes: number;
  therapistIds: string[];
  excludeTherapistId?: string;
}): Promise<Result<{ rows: TherapistAvailabilityRow[] }>> {
  await requirePermission('appointments.read');
  try {
    const rows = await getTherapistAvailabilityForTimeSlot({
      ...input,
      startsAt: new Date(input.startsAt),
    });
    return ok({ rows });
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

export async function cancelAppointmentAction(input: AppointmentCancelInput): Promise<
  Result<{
    appointmentId?: string;
    appointmentIds?: string[];
    flaggedShortNotice: boolean;
  }>
> {
  await requirePermission('appointments.cancel');
  const parsed = appointmentCancelSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  try {
    if (parsed.data.seriesMode === 'ONE') {
      const data = await cancelAppointment(parsed.data);
      revalidate();
      return ok(data);
    }
    const data = await cancelAppointmentSeries(parsed.data);
    revalidate();
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

// ─── Multi-appointment batch booking (July 31 item 4 — replaces the
//     Prompt 7b weekly-pattern series) ────────────────────────────────────

/**
 * Submit-time conflict sweep for the batch modal: every row runs the
 * conflict engine (room included) so ALL problem rows highlight at once.
 * Pure-read; the create below re-checks transactionally (race protection).
 */
export async function previewSeriesBatchAction(
  input: SeriesBatchCreateInput,
): Promise<Result<{ rows: BatchRowPreview[] }>> {
  await requirePermission('appointments.read');
  const parsed = seriesBatchCreateSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  try {
    const data = await previewSeriesBatch(parsed.data);
    return ok(data);
  } catch (err) {
    return fail(appointmentToLocalized(err));
  }
}

export async function createSeriesBatchAction(
  input: SeriesBatchCreateInput,
): Promise<Result<{ seriesId: string; appointmentIds: string[] }>> {
  await requirePermission('appointments.create');
  const parsed = seriesBatchCreateSchema.safeParse(input);
  if (!parsed.success) return fail(appointmentToLocalized(parsed.error));
  // No override path in the batch (FR-APP-8 replacement): a conflicting row
  // is fixed or removed, never overridden — so no override permission gate.
  try {
    const data = await createSeriesBatch(parsed.data);
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
