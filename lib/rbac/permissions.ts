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

  // ── Session notes ─────────────────────────────────────────────────────
  SESSION_NOTES_CREATE_OWN: 'session_notes.create.own', // therapist
  SESSION_NOTES_READ: 'session_notes.read', // secretary + admin
  SESSION_NOTES_READ_ASSIGNED: 'session_notes.read.assigned', // doctor / therapist
  SESSION_NOTES_UPDATE_OWN: 'session_notes.update.own', // therapist (within 24h)

  // ── Patient timeline ─────────────────────────────────────────────────
  PATIENT_TIMELINE_READ: 'patient_timeline.read', // secretary + admin (full)
  PATIENT_TIMELINE_READ_ASSIGNED: 'patient_timeline.read.assigned',
  PATIENT_TIMELINE_READ_LIMITED: 'patient_timeline.read.limited', // patient

  // ── Home program ──────────────────────────────────────────────────────
  HOME_PROGRAM_READ: 'home_program.read',
  HOME_PROGRAM_READ_OWN: 'home_program.read.own', // patient
  HOME_PROGRAM_CREATE_ASSIGNED: 'home_program.create.assigned', // therapist
  HOME_PROGRAM_UPDATE_ASSIGNED: 'home_program.update.assigned', // therapist

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

  // ── Reports ───────────────────────────────────────────────────────────
  REPORTS_READ: 'reports.read',
  REPORTS_READ_OWN: 'reports.read.own', // therapist — own end-of-day

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
  PERMISSIONS.EXERCISE_MEDIA_READ_OWN,
  PERMISSIONS.PATIENTS_READ_OWN,
  PERMISSIONS.PATIENTS_UPDATE_OWN,
  PERMISSIONS.INTAKE_READ_OWN,
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
]);

const DOCTOR_PERMS = new Set<PermissionCode>([
  PERMISSIONS.OWN_PROFILE_READ,
  PERMISSIONS.OWN_PROFILE_UPDATE,
  PERMISSIONS.USERS_READ_ASSIGNED,
  PERMISSIONS.APPOINTMENTS_READ_ASSIGNED,
  PERMISSIONS.TREATMENT_PLANS_CREATE,
  PERMISSIONS.TREATMENT_PLANS_READ_ASSIGNED,
  PERMISSIONS.TREATMENT_PLANS_UPDATE_OWN,
  PERMISSIONS.SESSION_NOTES_READ_ASSIGNED,
  PERMISSIONS.PATIENT_TIMELINE_READ_ASSIGNED,
  PERMISSIONS.HOME_PROGRAM_READ,
  PERMISSIONS.LEAVES_CREATE_OWN,
  PERMISSIONS.LEAVES_READ_OWN,
  PERMISSIONS.REPORTS_READ,
  PERMISSIONS.ROOMS_READ,
  PERMISSIONS.PATIENTS_READ_ASSIGNED,
  PERMISSIONS.INTAKE_READ_ASSIGNED,
]);

const THERAPIST_PERMS = new Set<PermissionCode>([
  PERMISSIONS.OWN_PROFILE_READ,
  PERMISSIONS.OWN_PROFILE_UPDATE,
  PERMISSIONS.USERS_READ_ASSIGNED,
  PERMISSIONS.APPOINTMENTS_READ_ASSIGNED,
  PERMISSIONS.APPOINTMENTS_STATUS_COMPLETE,
  PERMISSIONS.TREATMENT_PLANS_READ_ASSIGNED,
  PERMISSIONS.TREATMENT_PLANS_UPDATE_ASSIGNED,
  PERMISSIONS.SESSION_NOTES_CREATE_OWN,
  PERMISSIONS.SESSION_NOTES_READ_ASSIGNED,
  PERMISSIONS.SESSION_NOTES_UPDATE_OWN,
  PERMISSIONS.PATIENT_TIMELINE_READ_ASSIGNED,
  PERMISSIONS.HOME_PROGRAM_READ,
  PERMISSIONS.HOME_PROGRAM_CREATE_ASSIGNED,
  PERMISSIONS.HOME_PROGRAM_UPDATE_ASSIGNED,
  PERMISSIONS.EXERCISE_MEDIA_CREATE_OWN,
  PERMISSIONS.EXERCISE_MEDIA_UPDATE_OWN,
  PERMISSIONS.EXERCISE_MEDIA_DELETE_OWN,
  PERMISSIONS.LEAVES_CREATE_OWN,
  PERMISSIONS.LEAVES_READ_OWN,
  PERMISSIONS.REPORTS_READ_OWN,
  PERMISSIONS.ROOMS_READ,
  PERMISSIONS.PATIENTS_READ_ASSIGNED,
  PERMISSIONS.INTAKE_READ_ASSIGNED,
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
