import type { UserRole } from '@prisma/client';

/**
 * Role-aware clinical link builders (Prompt 37 item 3 — the Prompt 33 A-19
 * disease on the surfaces that prompt left flagged: timeline entries and the
 * Plan tab used to hardcode /secretary/… /doctor/… /therapist/… segments and
 * serve them to whatever role was viewing, teleporting Admins and
 * Secretaries into other roles' shells).
 *
 * Rule: the VIEWER's (effective, impersonation-aware) role picks the
 * segment; a role that genuinely lacks the page gets `null` and the caller
 * renders plain text — no 404s, no wrong-interface jumps.
 */

type Role = UserRole | 'ADMIN' | 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'PATIENT';

/** The viewer's calendar surface (every staff role has one; patients none). */
export function roleCalendarHref(role: Role): string | null {
  switch (role) {
    case 'ADMIN':
      return '/admin/calendar';
    case 'SECRETARY':
      return '/secretary/calendar';
    case 'DOCTOR':
      return '/doctor/calendar';
    case 'THERAPIST':
      return '/therapist/calendar';
    default:
      return null;
  }
}

/** Plan detail — only doctor + therapist own plan routes. */
export function planHref(role: Role, planId: string): string | null {
  switch (role) {
    case 'DOCTOR':
      return `/doctor/plans/${planId}`;
    case 'THERAPIST':
      return `/therapist/plans/${planId}`;
    default:
      return null;
  }
}

/** Plan edit / propose-change form. */
export function planEditHref(role: Role, planId: string): string | null {
  const base = planHref(role, planId);
  return base ? `${base}/edit` : null;
}

/** Session-note editor — a therapist-only surface. */
export function sessionNoteEditHref(role: Role, noteId: string): string | null {
  return role === 'THERAPIST' ? `/therapist/sessions/notes/${noteId}/edit` : null;
}

/** Weekly doctor review — doctor-only surface. */
export function weeklyReviewHref(role: Role): string | null {
  return role === 'DOCTOR' ? '/doctor/reports/weekly' : null;
}
