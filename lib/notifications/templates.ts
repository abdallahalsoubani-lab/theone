import type { NotificationType } from '@prisma/client';

/**
 * Notification templates — the static map of `NotificationType` to the
 * i18n keys (`titleKey`, `bodyKey`) the row stores. The renderer reads
 * `notifications.types.{type}.title` and `.body`, then interpolates
 * `params` into the localized template.
 *
 * Keep the `params` set narrow per type so the localized templates don't
 * drift. The TypeScript types below document the expected param shapes
 * for each notification; the `createNotification` action enforces them
 * at the call site.
 */

export interface NotificationTemplate {
  titleKey: string;
  bodyKey: string;
}

export const NOTIFICATION_TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  PLAN_ASSIGNED: {
    titleKey: 'notifications.types.PLAN_ASSIGNED.title',
    bodyKey: 'notifications.types.PLAN_ASSIGNED.body',
  },
  PLAN_PROPOSAL_RECEIVED: {
    titleKey: 'notifications.types.PLAN_PROPOSAL_RECEIVED.title',
    bodyKey: 'notifications.types.PLAN_PROPOSAL_RECEIVED.body',
  },
  PLAN_PROPOSAL_APPROVED: {
    titleKey: 'notifications.types.PLAN_PROPOSAL_APPROVED.title',
    bodyKey: 'notifications.types.PLAN_PROPOSAL_APPROVED.body',
  },
  PLAN_PROPOSAL_REJECTED: {
    titleKey: 'notifications.types.PLAN_PROPOSAL_REJECTED.title',
    bodyKey: 'notifications.types.PLAN_PROPOSAL_REJECTED.body',
  },
  PLAN_PAUSED: {
    titleKey: 'notifications.types.PLAN_PAUSED.title',
    bodyKey: 'notifications.types.PLAN_PAUSED.body',
  },
  PLAN_DISCONTINUED: {
    titleKey: 'notifications.types.PLAN_DISCONTINUED.title',
    bodyKey: 'notifications.types.PLAN_DISCONTINUED.body',
  },
  DAY_REPORT_SUBMITTED: {
    titleKey: 'notifications.types.DAY_REPORT_SUBMITTED.title',
    bodyKey: 'notifications.types.DAY_REPORT_SUBMITTED.body',
  },
  DOCTOR_REVIEW_ADDED: {
    titleKey: 'notifications.types.DOCTOR_REVIEW_ADDED.title',
    bodyKey: 'notifications.types.DOCTOR_REVIEW_ADDED.body',
  },
  APPOINTMENT_RESCHEDULE_REQUEST: {
    titleKey: 'notifications.types.APPOINTMENT_RESCHEDULE_REQUEST.title',
    bodyKey: 'notifications.types.APPOINTMENT_RESCHEDULE_REQUEST.body',
  },
  LOW_COMPLIANCE: {
    titleKey: 'notifications.types.LOW_COMPLIANCE.title',
    bodyKey: 'notifications.types.LOW_COMPLIANCE.body',
  },
  APPOINTMENT_THERAPIST_ASSIGNED: {
    titleKey: 'notifications.types.APPOINTMENT_THERAPIST_ASSIGNED.title',
    bodyKey: 'notifications.types.APPOINTMENT_THERAPIST_ASSIGNED.body',
  },
  APPOINTMENT_THERAPIST_REMOVED: {
    titleKey: 'notifications.types.APPOINTMENT_THERAPIST_REMOVED.title',
    bodyKey: 'notifications.types.APPOINTMENT_THERAPIST_REMOVED.body',
  },
  LEAVE_REQUESTED: {
    titleKey: 'notifications.types.LEAVE_REQUESTED.title',
    bodyKey: 'notifications.types.LEAVE_REQUESTED.body',
  },
  LEAVE_APPROVED: {
    titleKey: 'notifications.types.LEAVE_APPROVED.title',
    bodyKey: 'notifications.types.LEAVE_APPROVED.body',
  },
  LEAVE_REJECTED: {
    titleKey: 'notifications.types.LEAVE_REJECTED.title',
    bodyKey: 'notifications.types.LEAVE_REJECTED.body',
  },
  HOME_PROGRAM_SUBMITTED: {
    titleKey: 'notifications.types.HOME_PROGRAM_SUBMITTED.title',
    bodyKey: 'notifications.types.HOME_PROGRAM_SUBMITTED.body',
  },
  HOME_PROGRAM_APPROVED: {
    titleKey: 'notifications.types.HOME_PROGRAM_APPROVED.title',
    bodyKey: 'notifications.types.HOME_PROGRAM_APPROVED.body',
  },
  HOME_PROGRAM_CHANGES_REQUESTED: {
    titleKey: 'notifications.types.HOME_PROGRAM_CHANGES_REQUESTED.title',
    bodyKey: 'notifications.types.HOME_PROGRAM_CHANGES_REQUESTED.body',
  },
};

/**
 * Documented param shapes per type. Carried as `Json` on the row; the
 * UI interpolates with `next-intl`'s ICU placeholders.
 */
export type NotificationParams = {
  PLAN_ASSIGNED: { doctorName: string; patientName: string };
  PLAN_PROPOSAL_RECEIVED: { therapistName: string; patientName: string; reason: string };
  PLAN_PROPOSAL_APPROVED: { doctorName: string; patientName: string };
  PLAN_PROPOSAL_REJECTED: { doctorName: string; patientName: string; reason: string };
  PLAN_PAUSED: { patientName: string };
  PLAN_DISCONTINUED: { patientName: string };
  DAY_REPORT_SUBMITTED: { therapistName: string; date: string };
  DOCTOR_REVIEW_ADDED: { doctorName: string; patientName: string };
  APPOINTMENT_RESCHEDULE_REQUEST: { patientName: string };
  LOW_COMPLIANCE: { patientName: string; rate: string };
  APPOINTMENT_THERAPIST_ASSIGNED: { patientName: string; date: string };
  APPOINTMENT_THERAPIST_REMOVED: { patientName: string; date: string };
  LEAVE_REQUESTED: { requesterName: string; dateRange: string };
  LEAVE_APPROVED: { dateRange: string };
  LEAVE_REJECTED: { reason: string; dateRange: string };
  HOME_PROGRAM_SUBMITTED: { therapistName: string; patientName: string };
  HOME_PROGRAM_APPROVED: { doctorName: string; patientName: string };
  HOME_PROGRAM_CHANGES_REQUESTED: { doctorName: string; patientName: string };
};
