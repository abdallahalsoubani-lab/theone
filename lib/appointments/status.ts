import { AppointmentStatus, UserRole } from '@prisma/client';

import type { LocalizedError } from '@/lib/db';

/**
 * Appointment status state machine (Prompt 7 §4.8).
 *
 * Terminal: COMPLETED, CANCELLED, NO_SHOW — once an appointment lands in any
 * of these, status is frozen. Everything else is reachable per the table
 * below; illegal transitions throw a localized error.
 */
export const STATUS_TRANSITIONS: Record<AppointmentStatus, ReadonlyArray<AppointmentStatus>> = {
  SCHEDULED: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  CONFIRMED: [
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  IN_PROGRESS: [AppointmentStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Permission check for a specific transition. Returns the permission code
 * the caller must hold. Secretary/Admin can drive any non-terminal-to-
 * terminal transition; Therapist may only complete an in-progress
 * appointment THEY OWN (the .own scope is enforced at the call site).
 *
 * Returns null when the transition is illegal regardless of role.
 */
export function permissionForTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): string | null {
  if (!canTransition(from, to)) return null;
  if (to === AppointmentStatus.CANCELLED) return 'appointments.cancel';
  if (to === AppointmentStatus.NO_SHOW) return 'appointments.noshow';
  if (to === AppointmentStatus.IN_PROGRESS) return 'appointments.checkin';
  if (to === AppointmentStatus.COMPLETED) return 'appointments.complete';
  if (to === AppointmentStatus.CONFIRMED) return 'appointments.update';
  return null;
}

/**
 * Localized errors thrown by the status-change service when a transition
 * fails. Keep in lockstep with the i18n catalog — codes are stable so the
 * UI can branch reliably.
 */
export const STATUS_ERRORS = {
  INVALID_TRANSITION: (from: AppointmentStatus, to: AppointmentStatus): LocalizedError => ({
    code: 'APPOINTMENT_INVALID_TRANSITION',
    message_en: `Cannot move appointment from ${from} to ${to}.`,
    message_ar: `لا يمكن نقل الموعد من ${from} إلى ${to}.`,
    details: { from, to },
  }),
  CANCEL_REASON_REQUIRED: {
    code: 'APPOINTMENT_CANCEL_REASON_REQUIRED',
    message_en: 'A cancellation reason is required.',
    message_ar: 'يجب إدخال سبب الإلغاء.',
  } as LocalizedError,
  FORBIDDEN: {
    code: 'FORBIDDEN',
    message_en: 'You do not have permission for this action.',
    message_ar: 'ليست لديك صلاحية لهذا الإجراء.',
  } as LocalizedError,
} as const;

/**
 * Roles that can transition the status of an appointment they did NOT
 * book or aren't assigned to. Secretary + Admin are the operational
 * heart of the clinic.
 */
export const STATUS_BROAD_ACTORS = new Set<UserRole>([UserRole.SECRETARY, UserRole.ADMIN]);
