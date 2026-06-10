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
}): string {
  return args.sessionNoteId
    ? `/therapist/sessions/notes/${args.sessionNoteId}/edit`
    : `/therapist/patients/${args.patientId}`;
}
