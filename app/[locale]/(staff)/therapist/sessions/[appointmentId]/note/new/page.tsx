import { NewSessionNoteBody } from '@/components/clinical/session-note-pages';

/**
 * Therapist session-note creation page (Prompt 9 §4.7.2; body shared with
 * the doctor's mirror route since Prompt 46 row 5).
 */
export default async function NewSessionNotePage({
  params,
}: {
  params: Promise<{ locale: string; appointmentId: string }>;
}) {
  const { locale, appointmentId } = await params;
  return (
    <NewSessionNoteBody
      locale={locale}
      appointmentId={appointmentId}
      patientsBasePath="/therapist/patients"
      sessionsBasePath="/therapist/sessions"
    />
  );
}
