import { AddendumBody } from '@/components/clinical/session-note-pages';

/** Addendum to a primary note (body shared with the doctor's mirror route). */
export default async function AddAddendumPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  return <AddendumBody locale={locale} noteId={id} patientsBasePath="/therapist/patients" />;
}
