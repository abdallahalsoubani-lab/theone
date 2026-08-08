/**
 * Who a SESSION is booked with — the doctor or a therapist (PT-B4 item 1).
 *
 * This is deliberately NOT a new `AppointmentType`. The codebase already
 * defines a doctor visit as "an appointment whose assigned clinician is a
 * DOCTOR" (lib/patients/first-visit.ts derives the first-visit flag exactly
 * that way), so adding an enum value would create a second, divergable source
 * of truth for the same fact — a row could claim DOCTOR_VISIT while carrying a
 * therapist, or vice versa. The booking type stays SESSION; this picks which
 * clinicians the form offers, and the assignee's role remains the truth.
 *
 * Pure so the split is unit-testable without the modal.
 */

export type SessionKind = 'THERAPIST' | 'DOCTOR';

export const SESSION_KINDS: readonly SessionKind[] = ['THERAPIST', 'DOCTOR'];

/**
 * The clinicians offered for a session of this kind. A clinician with no role
 * (older callers pass a trimmed shape) is treated as a therapist, which is
 * what every pre-existing booking flow means.
 */
export function cliniciansForKind<T extends { role?: string | null }>(
  clinicians: readonly T[],
  kind: SessionKind,
): T[] {
  return clinicians.filter((c) =>
    kind === 'DOCTOR' ? c.role === 'DOCTOR' : (c.role ?? 'THERAPIST') !== 'DOCTOR',
  );
}

/**
 * The kind a picked clinician set represents — DOCTOR as soon as any assignee
 * is a doctor. Used to keep the selector honest when a set is prefilled (e.g.
 * dragging into a doctor's calendar lane).
 */
export function kindOfSelection<T extends { id: string; role?: string | null }>(
  clinicians: readonly T[],
  selectedIds: readonly string[],
): SessionKind {
  const picked = clinicians.filter((c) => selectedIds.includes(c.id));
  return picked.some((c) => c.role === 'DOCTOR') ? 'DOCTOR' : 'THERAPIST';
}
