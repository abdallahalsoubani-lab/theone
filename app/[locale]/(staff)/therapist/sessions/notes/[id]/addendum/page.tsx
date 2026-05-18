import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SessionNoteForm } from '@/components/clinical/SessionNoteForm';
import { getSessionNoteById } from '@/lib/clinical/session-notes/queries';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

export default async function AddAddendumPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('session_notes.addendum');
  const t = await getTranslations('clinical.notes');

  const parent = await getSessionNoteById(id);
  if (!parent || parent.parentNoteId) notFound();
  const appt = await db.appointment.findUnique({
    where: { id: parent.appointmentId },
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
        <h1 className="text-2xl font-medium text-brand-navy">{t('addendumTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('addendumSubtitle')}</p>
      </header>
      <SessionNoteForm
        mode="addendum"
        targetId={parent.id}
        appointmentLabel={appt.startsAt.toLocaleString(locale === 'ar' ? 'ar' : 'en')}
        patientLabel={patientName}
        redirectTo={`/therapist/patients/${parent.patientId}`}
      />
    </section>
  );
}
