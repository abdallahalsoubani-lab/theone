import type { AppointmentStatus, UserRole } from '@prisma/client';

/**
 * Session-report eligibility (Prompt 46 row 5) — one shared answer for
 * every entry-point surface (calendar side panel, therapist dashboard,
 * patient file) AND mirrored by the server guard in services.ts.
 *
 * A report can be added/edited only for a session that is IN_PROGRESS or
 * COMPLETED — never for cancelled, no-show, or not-yet-started
 * appointments.
 */
export function canAddSessionReport(status: AppointmentStatus): boolean {
  return status === 'IN_PROGRESS' || status === 'COMPLETED';
}

/** Roles that author session reports (therapist assignment is enforced
 *  server-side; the doctor authors for any session — clinical authoring,
 *  not an appointment mutation, so Prompt 45 is untouched). */
export function roleAuthorsSessionReports(role: UserRole): boolean {
  return role === 'THERAPIST' || role === 'DOCTOR' || role === 'ADMIN';
}

/** "Note missing" flag — a finished session with no primary report yet
 *  (restores the guarantee Prompt 25b promised: auto-completion must not
 *  silently discard the note requirement). */
export function isSessionReportMissing(
  status: AppointmentStatus,
  hasPrimaryNote: boolean,
): boolean {
  return status === 'COMPLETED' && !hasPrimaryNote;
}
