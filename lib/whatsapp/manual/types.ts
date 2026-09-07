import type { WaDispatchType } from '@prisma/client';

/**
 * P60 — the six message types a SECRETARY/ADMIN can send by hand from the
 * appointment panel. Pure module (no db, no React) shared by the server
 * action, the applicability rules, and the panel.
 */
export const MANUAL_MESSAGE_TYPES = [
  'CONFIRMATION',
  'REMINDER',
  'RESCHEDULE',
  'CANCELLATION',
  'ARRIVAL',
  'CUSTOM',
] as const;

export type ManualMessageType = (typeof MANUAL_MESSAGE_TYPES)[number];

/** The automatic dispatch class a manual send supersedes (decision 5). The
 *  custom message has no automatic counterpart. */
export const DISPATCH_TYPE_BY_MANUAL: Record<ManualMessageType, WaDispatchType | null> = {
  CONFIRMATION: 'BOOKING_CONFIRMATION',
  REMINDER: 'REMINDER',
  RESCHEDULE: 'RESCHEDULE',
  CANCELLATION: 'CANCELLATION',
  ARRIVAL: 'ARRIVAL',
  CUSTOM: null,
};

/** Which stored template rows count as "this type was already sent" for the
 *  duplicate guard (decision 7). Names, not ids — the registry versions
 *  templates by name (v2 / v3 / single / multi). */
export const TEMPLATE_FAMILY_BY_MANUAL: Record<ManualMessageType, readonly string[]> = {
  CONFIRMATION: ['appointment_confirmation_v2', 'new_patient_confirmation'],
  REMINDER: [
    'appointment_reminder_v2',
    'appointment_reminder_single_v3',
    'appointment_reminder_multi',
  ],
  RESCHEDULE: ['appointment_rescheduled'],
  CANCELLATION: ['appointment_cancelled_v2'],
  ARRIVAL: ['arrival_confirmation'],
  CUSTOM: ['clinic_custom_message'],
};

export function isManualMessageType(v: unknown): v is ManualMessageType {
  return typeof v === 'string' && (MANUAL_MESSAGE_TYPES as readonly string[]).includes(v);
}
