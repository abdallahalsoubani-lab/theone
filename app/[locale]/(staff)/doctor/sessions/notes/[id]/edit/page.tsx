import { EditSessionNoteBody } from '@/components/clinical/session-note-pages';

/** Doctor mirror of the note editor (Prompt 46 row 5); author-gated on save. */
export default async function DoctorEditSessionNotePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  return <EditSessionNoteBody locale={locale} noteId={id} patientsBasePath="/doctor/patients" />;
}
