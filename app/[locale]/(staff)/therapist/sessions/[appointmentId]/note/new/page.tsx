import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { SessionNoteForm } from '@/components/clinical/SessionNoteForm';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Therapist session-note creation page (Prompt 9 §4.7.2).
 *
 * Linked from the appointment side panel's "Mark completed" action.
 * The page short-circuits to the edit view if a primary note already
 * exists for this appointment — the unique partial index would
 * otherwise reject the post.
 */
export default async function NewSessionNotePage({
  params,
}: {
  params: Promise<{ locale: string; appointmentId: string }>;
}) {
  const { locale, appointmentId } = await params;
  setRequestLocale(locale);
  await requirePermission('session_notes.create.own', {});
  const t = await getTranslations('clinical.notes');

  const appt = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      startsAt: true,
      patientId: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  if (!appt) notFound();

  const existing = await db.sessionNote.findFirst({
    where: { appointmentId: appt.id, parentNoteId: null },
    select: { id: true },
  });
  if (existing) {
    redirect(`/${locale}/therapist/sessions/notes/${existing.id}/edit`);
  }

  const patientName = locale === 'ar' ? appt.patient.fullNameAr : appt.patient.fullNameEn;

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('newNoteTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('newNoteSubtitle')}</p>
      </header>
      <SessionNoteForm
        mode="create"
        targetId={appt.id}
        appointmentLabel={appt.startsAt.toLocaleString(locale === 'ar' ? 'ar' : 'en')}
        patientLabel={patientName}
        redirectTo={`/therapist/patients/${appt.patientId}`}
      />
    </section>
  );
}
