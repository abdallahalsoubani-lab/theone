/**
 * Where a therapist's "today's schedule" appointment card links to
 * (pre-Prompt-16 fix — the cards used to be dead ends).
 *
 * If a primary session note has been written for the appointment, deep-link to
 * it; otherwise link to the patient file, which reaches the plan / session
 * reports / home-program tabs and the new-note flow.
 */
export function therapistAppointmentHref(args: {
  patientId: string;
  sessionNoteId?: string | null;
  /** Prompt 46 row 5 — a COMPLETED session with no note deep-links straight
   *  to the create form instead of the patient file, so the "note missing"
   *  card is one tap from being fixed. */
  appointmentIdForMissingNote?: string | null;
}): string {
  if (args.sessionNoteId) return `/therapist/sessions/notes/${args.sessionNoteId}/edit`;
  if (args.appointmentIdForMissingNote) {
    return `/therapist/sessions/${args.appointmentIdForMissingNote}/note/new`;
  }
  return `/therapist/patients/${args.patientId}`;
}
