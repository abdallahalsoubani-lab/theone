import { UserRole } from '@prisma/client';

/**
 * Permission catalogue — encodes the RBAC matrix in **technical spec §4.1**.
 *
 * Code format: `{resource}.{action}[.{scope}]`
 *   - action ∈ create | read | update | delete
 *   - scope ∈ own | assigned | limited (omitted = unscoped)
 *
 * `.own`      — the actor is the resource owner (e.g. patient on their own data)
 * `.assigned` — the actor is the clinician currently assigned to the patient
 * `.limited`  — a redacted/curated view (used for patient timeline)
 *
 * When you add a permission code: add it to PERMISSIONS, then to every role
 * set that should have it, then add a test row in __tests__/can.test.ts.
 * Do NOT invent codes that aren't in spec §4.1 — raise a question first.
 */

export const PERMISSIONS = {
  // ── Own profile (every role can read + update their own user row) ─────
  OWN_PROFILE_READ: 'own_profile.read',
  OWN_PROFILE_UPDATE: 'own_profile.update',

  // ── Other users ────────────────────────────────────────────────────────
  USERS_CREATE: 'users.create',
  USERS_READ: 'users.read',
  USERS_READ_PATIENTS: 'users.read.patients', // secretary
  USERS_READ_THERAPISTS: 'users.read.therapists', // secretary
  USERS_READ_ASSIGNED: 'users.read.assigned', // doctor / therapist — own patients
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',

  // ── Appointments ──────────────────────────────────────────────────────
  APPOINTMENTS_CREATE: 'appointments.create',
  APPOINTMENTS_READ: 'appointments.read',
  APPOINTMENTS_READ_OWN: 'appointments.read.own', // patient — own appointments
  APPOINTMENTS_READ_ASSIGNED: 'appointments.read.assigned', // clinician — assigned
  APPOINTMENTS_UPDATE: 'appointments.update',
  APPOINTMENTS_DELETE: 'appointments.delete',
  APPOINTMENTS_CANCEL: 'appointments.cancel',
  APPOINTMENTS_STATUS_CHECKIN: 'appointments.checkin',
  APPOINTMENTS_STATUS_COMPLETE: 'appointments.complete', // therapist (own) + secretary/admin
  APPOINTMENTS_STATUS_NOSHOW: 'appointments.noshow',
  APPOINTMENTS_OVERRIDE_CONFLICT: 'appointments.override_conflict',

  // ── Treatment plans ───────────────────────────────────────────────────
  TREATMENT_PLANS_CREATE: 'treatment_plans.create',
  TREATMENT_PLANS_READ: 'treatment_plans.read',
  TREATMENT_PLANS_READ_OWN: 'treatment_plans.read.own', // patient
  TREATMENT_PLANS_READ_ASSIGNED: 'treatment_plans.read.assigned',
  TREATMENT_PLANS_UPDATE_OWN: 'treatment_plans.update.own', // doctor — own
  TREATMENT_PLANS_UPDATE_ASSIGNED: 'treatment_plans.update.assigned', // therapist
  // Proposal workflow (Prompt 9 §4.4-§4.5). 2-segment codes to match the
  // can() parser; the "assigned-therapist-only" guard is enforced inside
  // each action via the resource-scope check in lib/clinical/plans.
  TREATMENT_PLANS_PROPOSE: 'treatment_plans.propose',
  TREATMENT_PLANS_APPROVE: 'treatment_plans.approve',
  TREATMENT_PLANS_REJECT: 'treatment_plans.reject',
  TREATMENT_PLANS_PAUSE: 'treatment_plans.pause',
  TREATMENT_PLANS_COMPLETE: 'treatment_plans.complete',
  TREATMENT_PLANS_DISCONTINUE: 'treatment_plans.discontinue',

  // ── Session notes ─────────────────────────────────────────────────────
  SESSION_NOTES_CREATE_OWN: 'session_notes.create.own', // therapist
  SESSION_NOTES_READ: 'session_notes.read', // secretary + admin
  SESSION_NOTES_READ_ASSIGNED: 'session_notes.read.assigned', // doctor / therapist
  SESSION_NOTES_UPDATE_OWN: 'session_notes.update.own', // therapist (within 24h)
  SESSION_NOTES_ADDENDUM: 'session_notes.addendum', // therapist + doctor + admin

  // ── Patient timeline ─────────────────────────────────────────────────
  PATIENT_TIMELINE_READ: 'patient_timeline.read', // secretary + admin (full)
  PATIENT_TIMELINE_READ_ASSIGNED: 'patient_timeline.read.assigned',
  PATIENT_TIMELINE_READ_LIMITED: 'patient_timeline.read.limited', // patient

  // ── Home program ──────────────────────────────────────────────────────
  HOME_PROGRAM_READ: 'home_program.read',
  HOME_PROGRAM_READ_OWN: 'home_program.read.own', // patient
  HOME_PROGRAM_CREATE_ASSIGNED: 'home_program.create.assigned', // therapist
  HOME_PROGRAM_UPDATE_ASSIGNED: 'home_program.update.assigned', // therapist

  // ── Exercise Library — manage exercises (Prompt 10 §4.3) ─────────────
  // Clinical staff can create + edit (which creates a new version). Only
  // Admin can archive / restore — soft delete is a structural decision.
  EXERCISES_CREATE: 'exercises.create',
  EXERCISES_READ: 'exercises.read',
  EXERCISES_UPDATE: 'exercises.update',
  EXERCISES_ARCHIVE: 'exercises.archive',

  // ── Home program (Prompt 10 §4.5-§4.6) — extends the Prompt 6 codes ──
  // home_program.read + home_program.read.own + home_program.create.assigned
  // + home_program.update.assigned already exist above. Three new codes:
  //   - home_program.create / update / delete: clinical management,
  //     Therapist (assigned) + Doctor + Admin.
  //   - home_program.complete.own: patient marks a scheduled occurrence done.
  HOME_PROGRAM_CREATE: 'home_program.create',
  HOME_PROGRAM_UPDATE: 'home_program.update',
  HOME_PROGRAM_DELETE: 'home_program.delete',
  HOME_PROGRAM_COMPLETE_OWN: 'home_program.complete.own',

  // ── Exercise media (uploaded files) ──────────────────────────────────
  EXERCISE_MEDIA_CREATE: 'exercise_media.create',
  EXERCISE_MEDIA_READ: 'exercise_media.read',
  EXERCISE_MEDIA_READ_OWN: 'exercise_media.read.own', // patient (their program)
  EXERCISE_MEDIA_UPDATE: 'exercise_media.update',
  EXERCISE_MEDIA_DELETE: 'exercise_media.delete',
  EXERCISE_MEDIA_CREATE_OWN: 'exercise_media.create.own', // therapist
  EXERCISE_MEDIA_UPDATE_OWN: 'exercise_media.update.own',
  EXERCISE_MEDIA_DELETE_OWN: 'exercise_media.delete.own',

  // ── Leaves ────────────────────────────────────────────────────────────
  LEAVES_CREATE_OWN: 'leaves.create.own',
  LEAVES_READ_OWN: 'leaves.read.own',
  LEAVES_READ: 'leaves.read',
  LEAVES_UPDATE: 'leaves.update',
  LEAVES_DELETE: 'leaves.delete',

  // ── Reports (end-of-day + end-of-week, Prompt 9) ─────────────────────
  REPORTS_READ: 'reports.read',
  REPORTS_READ_OWN: 'reports.read.own', // therapist — own end-of-day
  REPORTS_SUBMIT: 'reports.submit', // therapist — submit a DayReport
  REPORTS_REVIEW: 'reports.review', // doctor — weekly review page

  // ── Doctor reviews (Prompt 9) ─────────────────────────────────────────
  DOCTOR_REVIEWS_CREATE: 'doctor_reviews.create',
  DOCTOR_REVIEWS_READ_ASSIGNED: 'doctor_reviews.read.assigned',

  // ── Patient timeline (Prompt 9) ──────────────────────────────────────
  // Aggregated clinical narrative — read-only by design. The .assigned
  // variant is the clinical default; secretary/admin get the unscoped
  // variant via the existing PATIENT_TIMELINE_READ code from Prompt 6.
  TIMELINE_READ_ASSIGNED: 'timeline.read.assigned',

  // ── Notifications (everyone gets their own; Prompt 9) ─────────────────
  NOTIFICATIONS_READ_OWN: 'notifications.read.own',
  NOTIFICATIONS_MARK_READ_OWN: 'notifications.mark_read.own',

  // ── Rooms (read for all staff, mutations admin-only — Prompt 5 §4.7) ─
  // rooms.read is shared with the calendar so the appointment form (Prompt 7)
  // can populate the room selector for every staff role.
  ROOMS_READ: 'rooms.read',
  ROOMS_CREATE: 'rooms.create',
  ROOMS_UPDATE: 'rooms.update',
  ROOMS_ARCHIVE: 'rooms.archive',
  ROOMS_DELETE: 'rooms.delete',

  // ── Patients (Prompt 6) ──────────────────────────────────────────────
  PATIENTS_CREATE: 'patients.create',
  PATIENTS_READ: 'patients.read',
  PATIENTS_READ_ASSIGNED: 'patients.read.assigned',
  PATIENTS_READ_OWN: 'patients.read.own',
  PATIENTS_UPDATE: 'patients.update',
  PATIENTS_UPDATE_OWN: 'patients.update.own',
  PATIENTS_ARCHIVE: 'patients.archive',
  PATIENTS_RESET_PASSWORD: 'patients.reset_password',

  // ── Intake assessments (Prompt 6) ─────────────────────────────────────
  INTAKE_CREATE: 'intake.create',
  INTAKE_READ: 'intake.read',
  INTAKE_READ_ASSIGNED: 'intake.read.assigned',
  INTAKE_READ_OWN: 'intake.read.own',
  INTAKE_UPDATE: 'intake.update',

  // ── WhatsApp templates (admin only) ──────────────────────────────────
  WHATSAPP_TEMPLATES_CREATE: 'whatsapp_templates.create',
  WHATSAPP_TEMPLATES_READ: 'whatsapp_templates.read',
  WHATSAPP_TEMPLATES_UPDATE: 'whatsapp_templates.update',
  WHATSAPP_TEMPLATES_DELETE: 'whatsapp_templates.delete',

  // ── WhatsApp message log + resend (admin, Prompt 8) ──────────────────
  // 2-segment codes; the existing WHATSAPP_TEMPLATES_UPDATE serves as the
  // "manage templates" capability, so no separate manage code is needed.
  WHATSAPP_MESSAGES_READ: 'whatsapp_messages.read',
  WHATSAPP_MESSAGES_RESEND: 'whatsapp_messages.resend',

  // ── Secretary inbox (Prompt 8) ───────────────────────────────────────
  // Surfaces inbound reschedule/cancel requests and outbound delivery
  // failures. ADMIN inherits via the catch-all in can().
  INBOX_READ: 'inbox.read',
  INBOX_RESOLVE: 'inbox.resolve',

  // ── System settings (admin only) ─────────────────────────────────────
  SYSTEM_SETTINGS_CREATE: 'system_settings.create',
  SYSTEM_SETTINGS_READ: 'system_settings.read',
  SYSTEM_SETTINGS_UPDATE: 'system_settings.update',
  SYSTEM_SETTINGS_DELETE: 'system_settings.delete',

  // ── Audit log (admin only) ────────────────────────────────────────────
  AUDIT_LOG_READ: 'audit_log.read',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = new Set<string>(Object.values(PERMISSIONS));

const PATIENT_PERMS = new Set<PermissionCode>([
  PERMISSIONS.OWN_PROFILE_READ,
  PERMISSIONS.OWN_PROFILE_UPDATE,
  PERMISSIONS.APPOINTMENTS_READ_OWN,
  PERMISSIONS.TREATMENT_PLANS_READ_OWN,
  PERMISSIONS.PATIENT_TIMELINE_READ_LIMITED,
  PERMISSIONS.HOME_PROGRAM_READ_OWN,
  PERMISSIONS.HOME_PROGRAM_COMPLETE_OWN,
  PERMISSIONS.EXERCISES_READ,
  PERMISSIONS.EXERCISE_MEDIA_READ_OWN,
  PERMISSIONS.PATIENTS_READ_OWN,
  PERMISSIONS.PATIENTS_UPDATE_OWN,
  PERMISSIONS.INTAKE_READ_OWN,
  PERMISSIONS.NOTIFICATIONS_READ_OWN,
  PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN,
]);

const SECRETARY_PERMS = new Set<PermissionCode>([
  PERMISSIONS.OWN_PROFILE_READ,
  PERMISSIONS.OWN_PROFILE_UPDATE,
  PERMISSIONS.USERS_READ_PATIENTS,
  PERMISSIONS.USERS_READ_THERAPISTS,
  PERMISSIONS.APPOINTMENTS_CREATE,
  PERMISSIONS.APPOINTMENTS_READ,
  PERMISSIONS.APPOINTMENTS_UPDATE,
  PERMISSIONS.APPOINTMENTS_DELETE,
  PERMISSIONS.APPOINTMENTS_CANCEL,
  PERMISSIONS.APPOINTMENTS_STATUS_CHECKIN,
  PERMISSIONS.APPOINTMENTS_STATUS_COMPLETE,
  PERMISSIONS.APPOINTMENTS_STATUS_NOSHOW,
  PERMISSIONS.APPOINTMENTS_OVERRIDE_CONFLICT,
  PERMISSIONS.TREATMENT_PLANS_READ,
  PERMISSIONS.SESSION_NOTES_READ,
  PERMISSIONS.PATIENT_TIMELINE_READ,
  PERMISSIONS.HOME_PROGRAM_READ,
  PERMISSIONS.EXERCISES_READ,
  PERMISSIONS.LEAVES_CREATE_OWN,
  PERMISSIONS.LEAVES_READ_OWN,
  PERMISSIONS.LEAVES_READ,
  PERMISSIONS.REPORTS_READ,
  PERMISSIONS.ROOMS_READ,
  PERMISSIONS.PATIENTS_CREATE,
  PERMISSIONS.PATIENTS_READ,
  PERMISSIONS.PATIENTS_UPDATE,
  PERMISSIONS.PATIENTS_RESET_PASSWORD,
  PERMISSIONS.INTAKE_CREATE,
  PERMISSIONS.INTAKE_READ,
  PERMISSIONS.INTAKE_UPDATE,
  PERMISSIONS.INBOX_READ,
  PERMISSIONS.INBOX_RESOLVE,
  PERMISSIONS.NOTIFICATIONS_READ_OWN,
  PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN,
]);

const DOCTOR_PERMS = new Set<PermissionCode>([
  PERMISSIONS.OWN_PROFILE_READ,
  PERMISSIONS.OWN_PROFILE_UPDATE,
  PERMISSIONS.USERS_READ_ASSIGNED,
  PERMISSIONS.APPOINTMENTS_READ_ASSIGNED,
  PERMISSIONS.TREATMENT_PLANS_CREATE,
  PERMISSIONS.TREATMENT_PLANS_READ_ASSIGNED,
  PERMISSIONS.TREATMENT_PLANS_UPDATE_OWN,
  PERMISSIONS.TREATMENT_PLANS_APPROVE,
  PERMISSIONS.TREATMENT_PLANS_REJECT,
  PERMISSIONS.TREATMENT_PLANS_PAUSE,
  PERMISSIONS.TREATMENT_PLANS_COMPLETE,
  PERMISSIONS.TREATMENT_PLANS_DISCONTINUE,
  PERMISSIONS.SESSION_NOTES_READ_ASSIGNED,
  PERMISSIONS.SESSION_NOTES_ADDENDUM,
  PERMISSIONS.PATIENT_TIMELINE_READ_ASSIGNED,
  PERMISSIONS.TIMELINE_READ_ASSIGNED,
  PERMISSIONS.HOME_PROGRAM_READ,
  PERMISSIONS.HOME_PROGRAM_CREATE,
  PERMISSIONS.HOME_PROGRAM_UPDATE,
  PERMISSIONS.HOME_PROGRAM_DELETE,
  PERMISSIONS.EXERCISES_CREATE,
  PERMISSIONS.EXERCISES_READ,
  PERMISSIONS.EXERCISES_UPDATE,
  PERMISSIONS.LEAVES_CREATE_OWN,
  PERMISSIONS.LEAVES_READ_OWN,
  PERMISSIONS.REPORTS_READ,
  PERMISSIONS.REPORTS_REVIEW,
  PERMISSIONS.DOCTOR_REVIEWS_CREATE,
  PERMISSIONS.DOCTOR_REVIEWS_READ_ASSIGNED,
  PERMISSIONS.ROOMS_READ,
  PERMISSIONS.PATIENTS_READ_ASSIGNED,
  PERMISSIONS.INTAKE_READ_ASSIGNED,
  PERMISSIONS.NOTIFICATIONS_READ_OWN,
  PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN,
]);

const THERAPIST_PERMS = new Set<PermissionCode>([
  PERMISSIONS.OWN_PROFILE_READ,
  PERMISSIONS.OWN_PROFILE_UPDATE,
  PERMISSIONS.USERS_READ_ASSIGNED,
  PERMISSIONS.APPOINTMENTS_READ_ASSIGNED,
  PERMISSIONS.APPOINTMENTS_STATUS_COMPLETE,
  PERMISSIONS.TREATMENT_PLANS_READ_ASSIGNED,
  PERMISSIONS.TREATMENT_PLANS_UPDATE_ASSIGNED,
  PERMISSIONS.TREATMENT_PLANS_PROPOSE,
  PERMISSIONS.SESSION_NOTES_CREATE_OWN,
  PERMISSIONS.SESSION_NOTES_READ_ASSIGNED,
  PERMISSIONS.SESSION_NOTES_UPDATE_OWN,
  PERMISSIONS.SESSION_NOTES_ADDENDUM,
  PERMISSIONS.PATIENT_TIMELINE_READ_ASSIGNED,
  PERMISSIONS.TIMELINE_READ_ASSIGNED,
  PERMISSIONS.HOME_PROGRAM_READ,
  PERMISSIONS.HOME_PROGRAM_CREATE_ASSIGNED,
  PERMISSIONS.HOME_PROGRAM_UPDATE_ASSIGNED,
  PERMISSIONS.HOME_PROGRAM_CREATE,
  PERMISSIONS.HOME_PROGRAM_UPDATE,
  PERMISSIONS.HOME_PROGRAM_DELETE,
  PERMISSIONS.EXERCISES_CREATE,
  PERMISSIONS.EXERCISES_READ,
  PERMISSIONS.EXERCISES_UPDATE,
  PERMISSIONS.EXERCISE_MEDIA_CREATE_OWN,
  PERMISSIONS.EXERCISE_MEDIA_UPDATE_OWN,
  PERMISSIONS.EXERCISE_MEDIA_DELETE_OWN,
  PERMISSIONS.LEAVES_CREATE_OWN,
  PERMISSIONS.LEAVES_READ_OWN,
  PERMISSIONS.REPORTS_READ_OWN,
  PERMISSIONS.REPORTS_SUBMIT,
  PERMISSIONS.ROOMS_READ,
  PERMISSIONS.PATIENTS_READ_ASSIGNED,
  PERMISSIONS.INTAKE_READ_ASSIGNED,
  PERMISSIONS.NOTIFICATIONS_READ_OWN,
  PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN,
]);

const ADMIN_PERMS = new Set<PermissionCode>([
  PERMISSIONS.OWN_PROFILE_READ,
  PERMISSIONS.OWN_PROFILE_UPDATE,
  PERMISSIONS.USERS_CREATE,
  PERMISSIONS.USERS_READ,
  PERMISSIONS.USERS_UPDATE,
  PERMISSIONS.USERS_DELETE,
  PERMISSIONS.APPOINTMENTS_CREATE,
  PERMISSIONS.APPOINTMENTS_READ,
  PERMISSIONS.APPOINTMENTS_UPDATE,
  PERMISSIONS.APPOINTMENTS_DELETE,
  PERMISSIONS.TREATMENT_PLANS_READ,
  PERMISSIONS.SESSION_NOTES_READ,
  PERMISSIONS.PATIENT_TIMELINE_READ,
  PERMISSIONS.HOME_PROGRAM_READ,
  PERMISSIONS.HOME_PROGRAM_CREATE,
  PERMISSIONS.HOME_PROGRAM_UPDATE,
  PERMISSIONS.HOME_PROGRAM_DELETE,
  PERMISSIONS.EXERCISES_CREATE,
  PERMISSIONS.EXERCISES_READ,
  PERMISSIONS.EXERCISES_UPDATE,
  PERMISSIONS.EXERCISES_ARCHIVE,
  PERMISSIONS.EXERCISE_MEDIA_CREATE,
  PERMISSIONS.EXERCISE_MEDIA_READ,
  PERMISSIONS.EXERCISE_MEDIA_UPDATE,
  PERMISSIONS.EXERCISE_MEDIA_DELETE,
  PERMISSIONS.LEAVES_CREATE_OWN,
  PERMISSIONS.LEAVES_READ_OWN,
  PERMISSIONS.LEAVES_READ,
  PERMISSIONS.LEAVES_UPDATE,
  PERMISSIONS.LEAVES_DELETE,
  PERMISSIONS.REPORTS_READ,
  PERMISSIONS.REPORTS_SUBMIT,
  PERMISSIONS.REPORTS_REVIEW,
  PERMISSIONS.TREATMENT_PLANS_CREATE,
  PERMISSIONS.TREATMENT_PLANS_UPDATE_OWN,
  PERMISSIONS.TREATMENT_PLANS_PROPOSE,
  PERMISSIONS.TREATMENT_PLANS_APPROVE,
  PERMISSIONS.TREATMENT_PLANS_REJECT,
  PERMISSIONS.TREATMENT_PLANS_PAUSE,
  PERMISSIONS.TREATMENT_PLANS_COMPLETE,
  PERMISSIONS.TREATMENT_PLANS_DISCONTINUE,
  PERMISSIONS.SESSION_NOTES_CREATE_OWN,
  PERMISSIONS.SESSION_NOTES_UPDATE_OWN,
  PERMISSIONS.SESSION_NOTES_ADDENDUM,
  PERMISSIONS.DOCTOR_REVIEWS_CREATE,
  PERMISSIONS.DOCTOR_REVIEWS_READ_ASSIGNED,
  PERMISSIONS.TIMELINE_READ_ASSIGNED,
  PERMISSIONS.NOTIFICATIONS_READ_OWN,
  PERMISSIONS.NOTIFICATIONS_MARK_READ_OWN,
  PERMISSIONS.WHATSAPP_TEMPLATES_CREATE,
  PERMISSIONS.WHATSAPP_TEMPLATES_READ,
  PERMISSIONS.WHATSAPP_TEMPLATES_UPDATE,
  PERMISSIONS.WHATSAPP_TEMPLATES_DELETE,
  PERMISSIONS.SYSTEM_SETTINGS_CREATE,
  PERMISSIONS.SYSTEM_SETTINGS_READ,
  PERMISSIONS.SYSTEM_SETTINGS_UPDATE,
  PERMISSIONS.SYSTEM_SETTINGS_DELETE,
  PERMISSIONS.AUDIT_LOG_READ,
  PERMISSIONS.ROOMS_READ,
  PERMISSIONS.ROOMS_CREATE,
  PERMISSIONS.ROOMS_UPDATE,
  PERMISSIONS.ROOMS_ARCHIVE,
  PERMISSIONS.ROOMS_DELETE,
  PERMISSIONS.APPOINTMENTS_CANCEL,
  PERMISSIONS.APPOINTMENTS_STATUS_CHECKIN,
  PERMISSIONS.APPOINTMENTS_STATUS_COMPLETE,
  PERMISSIONS.APPOINTMENTS_STATUS_NOSHOW,
  PERMISSIONS.APPOINTMENTS_OVERRIDE_CONFLICT,
  PERMISSIONS.PATIENTS_CREATE,
  PERMISSIONS.PATIENTS_READ,
  PERMISSIONS.PATIENTS_UPDATE,
  PERMISSIONS.PATIENTS_ARCHIVE,
  PERMISSIONS.PATIENTS_RESET_PASSWORD,
  PERMISSIONS.INTAKE_CREATE,
  PERMISSIONS.INTAKE_READ,
  PERMISSIONS.INTAKE_UPDATE,
  PERMISSIONS.INBOX_READ,
  PERMISSIONS.INBOX_RESOLVE,
  PERMISSIONS.WHATSAPP_MESSAGES_READ,
  PERMISSIONS.WHATSAPP_MESSAGES_RESEND,
]);

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<PermissionCode>> = {
  [UserRole.PATIENT]: PATIENT_PERMS,
  [UserRole.SECRETARY]: SECRETARY_PERMS,
  [UserRole.DOCTOR]: DOCTOR_PERMS,
  [UserRole.THERAPIST]: THERAPIST_PERMS,
  [UserRole.ADMIN]: ADMIN_PERMS,
};

export function isKnownPermission(code: string): code is PermissionCode {
  return ALL_PERMISSIONS.has(code);
}

/** Helper for the style-guide permission table — listing in stable order. */
export function listPermissions(): PermissionCode[] {
  return Object.values(PERMISSIONS);
}
