import { AddendumBody } from '@/components/clinical/session-note-pages';

/** Doctor mirror of the addendum form (Prompt 46 row 5). */
export default async function DoctorAddAddendumPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  return <AddendumBody locale={locale} noteId={id} patientsBasePath="/doctor/patients" />;
}
