import type { UserRole } from '@prisma/client';

/**
 * Role-aware patient-profile links (Prompt 33 — A-19).
 *
 * Every staff role has its own patients segment with its own layout/sidebar;
 * hardcoding one segment (the old `/secretary/patients/...` in the calendar
 * side panel) silently teleported Admins/Doctors into the Secretary interface
 * with no way back but the browser Back button. All cross-role surfaces build
 * profile hrefs through here so the viewer always stays in their own shell.
 */

const BASE_BY_ROLE: Partial<Record<UserRole, string>> = {
  ADMIN: '/admin/patients',
  SECRETARY: '/secretary/patients',
  DOCTOR: '/doctor/patients',
  THERAPIST: '/therapist/patients',
};

/** The patients segment for a staff role (secretary shape as a safe fallback
 *  for unexpected roles — matches the pre-fix behaviour). */
export function patientsBasePath(role: UserRole): string {
  return BASE_BY_ROLE[role] ?? '/secretary/patients';
}

/** Href of a patient's file for the given viewer role. */
export function patientProfileHref(role: UserRole, patientId: string): string {
  return `${patientsBasePath(role)}/${patientId}`;
}
