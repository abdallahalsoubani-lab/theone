import { NewSessionNoteBody } from '@/components/clinical/session-note-pages';

/**
 * Doctor session-report creation (Prompt 46 row 5) — mirror of the
 * therapist route: /therapist/* is THERAPIST+ADMIN gated, so the doctor
 * gets the same body under the doctor shell. RBAC: the doctor holds
 * session_notes.create.own since this prompt.
 */
export default async function DoctorNewSessionNotePage({
  params,
}: {
  params: Promise<{ locale: string; appointmentId: string }>;
}) {
  const { locale, appointmentId } = await params;
  return (
    <NewSessionNoteBody
      locale={locale}
      appointmentId={appointmentId}
      patientsBasePath="/doctor/patients"
      sessionsBasePath="/doctor/sessions"
    />
  );
}
