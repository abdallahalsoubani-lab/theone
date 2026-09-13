import type { AppointmentStatus } from '@prisma/client';

import { MANUAL_MESSAGE_TYPES, type ManualMessageType } from './types';

/**
 * P60 §4.2 — which manual message types apply to an appointment in its
 * CURRENT state. Pure: evaluated by the server action (the authority) and
 * by the panel (display only, never trusted).
 *
 *   Confirmation / Reminder / Reschedule notice
 *       status ∈ {SCHEDULED, CONFIRMED} and startsAt > now
 *   Cancellation notice   status = CANCELLED
 *   Arrival confirmation  checked-in (IN_PROGRESS or checkedInAt set) and
 *                         the appointment has not ended (start + duration)
 *   Custom message        always — once the frame template is approved for
 *                         the patient's language
 *
 * Everything requires a scalar patient WITH a phone (EVENT/GROUP: nothing).
 */
export interface ApplicabilityInput {
  status: AppointmentStatus;
  startsAt: Date;
  durationMinutes: number;
  checkedInAt: Date | null;
  hasPatient: boolean;
  hasPhone: boolean;
  /** `clinic_custom_message` is twilioApproved for the patient's language. */
  customApproved: boolean;
  /**
   * P61 — the recipient is a GROUP member, so arrival is decided ONLY by
   * their own `AppointmentPatient.checkedInAt`: an IN_PROGRESS group session
   * does not mean every member walked in.
   */
  perPatientArrival?: boolean;
  now?: Date;
}

export function isManualTypeApplicable(
  type: ManualMessageType,
  input: ApplicabilityInput,
): boolean {
  if (!input.hasPatient || !input.hasPhone) return false;
  const now = (input.now ?? new Date()).getTime();
  const start = input.startsAt.getTime();
  const end = start + input.durationMinutes * 60_000;
  const upcomingActive =
    (input.status === 'SCHEDULED' || input.status === 'CONFIRMED') && start > now;

  switch (type) {
    case 'CONFIRMATION':
    case 'REMINDER':
    case 'RESCHEDULE':
      return upcomingActive;
    case 'CANCELLATION':
      return input.status === 'CANCELLED';
    case 'ARRIVAL':
      return (
        (input.perPatientArrival
          ? input.checkedInAt !== null
          : input.status === 'IN_PROGRESS' || input.checkedInAt !== null) && now < end
      );
    case 'CUSTOM':
      return input.customApproved;
  }
}

export function applicableManualTypes(input: ApplicabilityInput): ManualMessageType[] {
  return MANUAL_MESSAGE_TYPES.filter((t) => isManualTypeApplicable(t, input));
}
