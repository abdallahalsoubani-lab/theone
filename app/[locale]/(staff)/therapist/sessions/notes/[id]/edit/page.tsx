import { EditSessionNoteBody } from '@/components/clinical/session-note-pages';

/**
 * Edit a session note within the 24-hour window (author-gated server-side;
 * body shared with the doctor's mirror route since Prompt 46 row 5).
 */
export default async function EditSessionNotePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  return <EditSessionNoteBody locale={locale} noteId={id} patientsBasePath="/therapist/patients" />;
}
