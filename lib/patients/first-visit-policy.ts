import type { UserRole } from '@prisma/client';

/**
 * Doctor-first-visit UI policy (Prompt 41 — NI-5, owner ruling: SOFT).
 *
 * Pure, client-safe helpers — the DB derivation lives in
 * `lib/patients/first-visit.ts` (server-only); this module owns who sees the
 * badge / CTA so the rules are testable without rendering. Nothing here ever
 * blocks a booking. (The booking-modal notice was removed by clinic request
 * in Prompt 55 §3 — the badge + CTA are the remaining surfaces.)
 */

const BADGE_ROLES: readonly UserRole[] = ['SECRETARY', 'ADMIN', 'DOCTOR'];

const CTA_CALENDAR_BY_ROLE: Partial<Record<UserRole, string>> = {
  SECRETARY: '/secretary/calendar',
  ADMIN: '/admin/calendar',
};

/** Who sees the "Awaiting doctor visit" chip (file header + patients list). */
export function canSeeFirstVisitBadge(role: UserRole): boolean {
  return BADGE_ROLES.includes(role);
}

/**
 * "Book doctor visit" CTA target — the viewer's own calendar with the booking
 * modal auto-opened, prefilled with the patient and scoped to doctors.
 * Null (no CTA) once the first visit is completed, and for every role that
 * doesn't book (doctor/therapist/patient).
 */
export function bookDoctorVisitHref(
  role: UserRole,
  patientId: string,
  pendingFirstVisit: boolean,
): string | null {
  if (!pendingFirstVisit) return null;
  const calendar = CTA_CALENDAR_BY_ROLE[role];
  return calendar ? `${calendar}?bookPatient=${patientId}&doctors=1` : null;
}
