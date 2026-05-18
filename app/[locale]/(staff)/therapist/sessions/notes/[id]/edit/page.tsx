import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SessionNoteForm } from '@/components/clinical/SessionNoteForm';
import { getSessionNoteById } from '@/lib/clinical/session-notes/queries';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Edit a session note within the 24-hour window. The server action
 * will reject the update with SESSION_NOTE_IMMUTABLE if the window
 * has elapsed; the page also surfaces a banner so the therapist sees
 * the same fact before submitting.
 */
export default async function EditSessionNotePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('session_notes.update.own', {});
  const t = await getTranslations('clinical.notes');

  const note = await getSessionNoteById(id);
  if (!note) notFound();
  const appt = await db.appointment.findUnique({
    where: { id: note.appointmentId },
    select: {
      startsAt: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  if (!appt) notFound();

  const patientName = locale === 'ar' ? appt.patient.fullNameAr : appt.patient.fullNameEn;

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('editNoteTitle')}</h1>
        {note.isWithinEditWindow ? (
          <p className="mt-1 text-sm text-brand-textMuted">{t('editWindowOpen')}</p>
        ) : (
          <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t('editWindowClosed')}
          </p>
        )}
      </header>
      <SessionNoteForm
        mode="edit"
        targetId={note.id}
        appointmentLabel={appt.startsAt.toLocaleString(locale === 'ar' ? 'ar' : 'en')}
        patientLabel={patientName}
        initial={{
          subjective: note.subjective,
          objective: note.objective,
          assessment: note.assessment,
          plan: note.plan,
          painScore: note.painScore ?? 0,
          measurements: note.measurementsText,
        }}
        redirectTo={`/therapist/patients/${note.patientId}`}
      />
    </section>
  );
}
