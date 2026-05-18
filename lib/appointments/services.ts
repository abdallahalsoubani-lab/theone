import { AppointmentStatus, AuditAction, UserRole } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import {
  cancelAppointmentReminder,
  enqueueAppointmentReminder,
} from '@/lib/queue/jobs/appointmentReminder';

import { checkConflicts, type Conflict } from './conflicts';
import type {
  AppointmentCancelInput,
  AppointmentChangeTherapistInput,
  AppointmentCreateInput,
  AppointmentRescheduleInput,
} from './schemas';
import { canTransition, permissionForTransition, STATUS_ERRORS } from './status';

export class AppointmentError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'AppointmentError';
  }
}

const conflictError = (conflicts: Conflict[]): LocalizedError => ({
  code: 'APPOINTMENT_CONFLICT',
  message_en: `${conflicts.length} conflict(s) detected.`,
  message_ar: `تم اكتشاف ${conflicts.length} تعارض(ات).`,
  details: { conflicts: conflicts as unknown as Record<string, unknown> },
});

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};

const notFound: LocalizedError = {
  code: 'APPOINTMENT_NOT_FOUND',
  message_en: 'Appointment not found.',
  message_ar: 'لم يتم العثور على الموعد.',
};

async function getReminderOffsetMinutes(): Promise<number> {
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { defaultReminderOffsetMinutes: true },
  });
  return settings?.defaultReminderOffsetMinutes ?? 30;
}

export const createAppointment = withAudit<
  [AppointmentCreateInput],
  { appointmentId: string; conflictsOverridden: boolean }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.appointmentId,
    extractAfter: (result) => ({
      appointmentId: result.appointmentId,
      event: result.conflictsOverridden ? 'OVERRIDE_CONFLICT' : 'APPOINTMENT_CREATED',
    }),
  },
  async function createAppointmentInner(
    input: AppointmentCreateInput,
  ): Promise<{ appointmentId: string; conflictsOverridden: boolean }> {
    const session = await auth();
    if (!session?.user?.id) throw new AppointmentError(unauthenticated);

    const conflicts = await checkConflicts({
      patientId: input.patientId,
      therapistId: input.therapistId,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
    });

    if (!conflicts.ok && !input.overrideConflicts) {
      throw new AppointmentError(conflictError(conflicts.conflicts));
    }

    const appointment = await db.appointment.create({
      data: {
        patientId: input.patientId,
        therapistId: input.therapistId,
        roomId: input.roomId ?? null,
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        status: AppointmentStatus.SCHEDULED,
        notes: input.notes ?? null,
        createdById: session.user.id,
      },
    });

    const offset = await getReminderOffsetMinutes();
    await enqueueAppointmentReminder({
      appointmentId: appointment.id,
      startsAt: appointment.startsAt,
      reminderOffsetMinutes: offset,
    });

    return {
      appointmentId: appointment.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

export const rescheduleAppointment = withAudit<
  [AppointmentRescheduleInput],
  { appointmentId: string; conflictsOverridden: boolean }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) =>
      db.appointment.findUnique({
        where: { id: args[0].id },
        select: {
          startsAt: true,
          durationMinutes: true,
          therapistId: true,
          roomId: true,
        },
      }),
    extractAfter: (result) => ({
      event: result.conflictsOverridden ? 'OVERRIDE_CONFLICT' : 'APPOINTMENT_RESCHEDULED',
    }),
  },
  async function rescheduleInner(
    input: AppointmentRescheduleInput,
  ): Promise<{ appointmentId: string; conflictsOverridden: boolean }> {
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        patientId: true,
        therapistId: true,
        status: true,
      },
    });
    if (!existing) throw new AppointmentError(notFound);

    const therapistId = input.therapistId ?? existing.therapistId;

    const conflicts = await checkConflicts({
      appointmentId: input.id,
      patientId: existing.patientId,
      therapistId,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
    });

    if (!conflicts.ok && !input.overrideConflicts) {
      throw new AppointmentError(conflictError(conflicts.conflicts));
    }

    await db.appointment.update({
      where: { id: input.id },
      data: {
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        therapistId,
        roomId: input.roomId ?? null,
      },
    });

    // Re-enqueue the reminder against the new fire time.
    await cancelAppointmentReminder(input.id);
    if (
      existing.status === AppointmentStatus.SCHEDULED ||
      existing.status === AppointmentStatus.CONFIRMED
    ) {
      const offset = await getReminderOffsetMinutes();
      await enqueueAppointmentReminder({
        appointmentId: input.id,
        startsAt: input.startsAt,
        reminderOffsetMinutes: offset,
      });
    }

    return {
      appointmentId: input.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

export const changeAppointmentTherapist = withAudit<
  [AppointmentChangeTherapistInput],
  { appointmentId: string; conflictsOverridden: boolean }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractBefore: async (args) =>
      db.appointment.findUnique({
        where: { id: args[0].id },
        select: { therapistId: true },
      }),
    extractAfter: (result) => ({
      event: result.conflictsOverridden ? 'OVERRIDE_CONFLICT' : 'THERAPIST_CHANGED',
    }),
  },
  async function changeTherapistInner(input): Promise<{
    appointmentId: string;
    conflictsOverridden: boolean;
  }> {
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        patientId: true,
        startsAt: true,
        durationMinutes: true,
        status: true,
      },
    });
    if (!existing) throw new AppointmentError(notFound);

    const conflicts = await checkConflicts({
      appointmentId: input.id,
      patientId: existing.patientId,
      therapistId: input.therapistId,
      startsAt: existing.startsAt,
      durationMinutes: existing.durationMinutes,
    });
    if (!conflicts.ok && !input.overrideConflicts) {
      throw new AppointmentError(conflictError(conflicts.conflicts));
    }

    await db.appointment.update({
      where: { id: input.id },
      data: { therapistId: input.therapistId },
    });

    return {
      appointmentId: input.id,
      conflictsOverridden: !conflicts.ok && input.overrideConflicts,
    };
  },
);

export const cancelAppointment = withAudit<
  [AppointmentCancelInput],
  { appointmentId: string; flaggedShortNotice: boolean }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (result) => ({
      event: 'APPOINTMENT_CANCELLED',
      flaggedShortNotice: result.flaggedShortNotice,
    }),
  },
  async function cancelInner(input): Promise<{
    appointmentId: string;
    flaggedShortNotice: boolean;
  }> {
    const existing = await db.appointment.findUnique({
      where: { id: input.id },
      select: { id: true, status: true, startsAt: true },
    });
    if (!existing) throw new AppointmentError(notFound);
    if (!canTransition(existing.status, AppointmentStatus.CANCELLED)) {
      throw new AppointmentError(
        STATUS_ERRORS.INVALID_TRANSITION(existing.status, AppointmentStatus.CANCELLED),
      );
    }
    if (!input.cancellationReason) {
      throw new AppointmentError(STATUS_ERRORS.CANCEL_REASON_REQUIRED);
    }

    const shortNotice = existing.startsAt.getTime() - Date.now() < 2 * 60 * 60 * 1000;

    await db.appointment.update({
      where: { id: input.id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancellationReason: input.cancellationReason,
        cancellationCategory: input.cancellationCategory,
      },
    });
    await cancelAppointmentReminder(input.id);
    return { appointmentId: input.id, flaggedShortNotice: shortNotice };
  },
);

export const updateAppointmentStatus = withAudit<
  [{ id: string; to: AppointmentStatus }],
  { appointmentId: string }
>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (_result, ..._rest) => ({ event: 'STATUS_CHANGED' }),
  },
  async function updateStatusInner({ id, to }): Promise<{ appointmentId: string }> {
    const session = await auth();
    if (!session?.user) throw new AppointmentError(unauthenticated);

    const existing = await db.appointment.findUnique({
      where: { id },
      select: { id: true, status: true, therapistId: true, startsAt: true },
    });
    if (!existing) throw new AppointmentError(notFound);

    if (!canTransition(existing.status, to)) {
      throw new AppointmentError(STATUS_ERRORS.INVALID_TRANSITION(existing.status, to));
    }

    // Therapist may only complete THEIR OWN in-progress appointment.
    if (
      session.user.role === UserRole.THERAPIST &&
      to === AppointmentStatus.COMPLETED &&
      existing.therapistId !== session.user.id
    ) {
      throw new AppointmentError(STATUS_ERRORS.FORBIDDEN);
    }

    await db.appointment.update({
      where: { id },
      data: { status: to },
    });

    // Cancel the reminder if the appointment is no longer eligible (in-progress,
    // completed, or any terminal state).
    if (to !== AppointmentStatus.SCHEDULED && to !== AppointmentStatus.CONFIRMED) {
      await cancelAppointmentReminder(id);
    }

    return { appointmentId: id };
  },
);

export function appointmentToLocalized(err: unknown): LocalizedError {
  if (err instanceof AppointmentError) return err.error;
  return toLocalizedError(err);
}

/**
 * Permission resolver for `updateAppointmentStatus`. The 'use server'
 * facade should call requirePermission(...) with the code this returns.
 */
export function permissionForStatusChange(
  from: AppointmentStatus,
  to: AppointmentStatus,
): string | null {
  return permissionForTransition(from, to);
}
