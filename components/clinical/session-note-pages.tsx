import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { SessionNoteForm } from '@/components/clinical/SessionNoteForm';
import { getSessionNoteById } from '@/lib/clinical/session-notes/queries';
import { db } from '@/lib/db';
import { formatDateTime } from '@/lib/format/date';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Shared bodies for the session-report pages (Prompt 46 row 5).
 *
 * The forms shipped in Prompt 9 as therapist-only routes; the doctor now
 * authors reports too, via mirror routes under /doctor/sessions/*. Both
 * role routes render THESE bodies — the only differences are the route
 * segment and where the form returns to afterwards (`patientsBasePath`,
 * the viewer's own patient-file shell, per the Prompt 33/37 A-19 rule).
 */
interface SharedProps {
  locale: string;
  /** e.g. `/therapist/patients` or `/doctor/patients`. */
  patientsBasePath: string;
  /** e.g. `/therapist/sessions` or `/doctor/sessions` — for the
   *  already-has-a-note redirect out of the create page. */
  sessionsBasePath: string;
}

export async function NewSessionNoteBody({
  locale,
  appointmentId,
  patientsBasePath,
  sessionsBasePath,
}: SharedProps & { appointmentId: string }) {
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
    redirect(`/${locale}${sessionsBasePath}/notes/${existing.id}/edit`);
  }

  const patientName =
    locale === 'ar' ? (appt.patient?.fullNameAr ?? '') : (appt.patient?.fullNameEn ?? '');

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('newNoteTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('newNoteSubtitle')}</p>
      </header>
      <SessionNoteForm
        mode="create"
        targetId={appt.id}
        appointmentLabel={formatDateTime(appt.startsAt, locale === 'ar' ? 'ar' : 'en')}
        patientLabel={patientName}
        redirectTo={`${patientsBasePath}/${appt.patientId}`}
      />
    </section>
  );
}

export async function EditSessionNoteBody({
  locale,
  noteId,
  patientsBasePath,
}: Omit<SharedProps, 'sessionsBasePath'> & { noteId: string }) {
  setRequestLocale(locale);
  await requirePermission('session_notes.update.own', {});
  const t = await getTranslations('clinical.notes');

  const note = await getSessionNoteById(noteId);
  if (!note) notFound();
  const appt = await db.appointment.findUnique({
    where: { id: note.appointmentId },
    select: {
      startsAt: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  if (!appt) notFound();

  const patientName =
    locale === 'ar' ? (appt.patient?.fullNameAr ?? '') : (appt.patient?.fullNameEn ?? '');

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
        appointmentLabel={formatDateTime(appt.startsAt, locale === 'ar' ? 'ar' : 'en')}
        patientLabel={patientName}
        initial={{
          subjective: note.subjective,
          objective: note.objective,
          assessment: note.assessment,
          plan: note.plan,
          painScore: note.painScore ?? 0,
          measurements: note.measurementsText,
        }}
        redirectTo={`${patientsBasePath}/${note.patientId}`}
      />
    </section>
  );
}

export async function AddendumBody({
  locale,
  noteId,
  patientsBasePath,
}: Omit<SharedProps, 'sessionsBasePath'> & { noteId: string }) {
  setRequestLocale(locale);
  await requirePermission('session_notes.addendum');
  const t = await getTranslations('clinical.notes');

  const parent = await getSessionNoteById(noteId);
  if (!parent || parent.parentNoteId) notFound();
  const appt = await db.appointment.findUnique({
    where: { id: parent.appointmentId },
    select: {
      startsAt: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  if (!appt) notFound();

  const patientName =
    locale === 'ar' ? (appt.patient?.fullNameAr ?? '') : (appt.patient?.fullNameEn ?? '');

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('addendumTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('addendumSubtitle')}</p>
      </header>
      <SessionNoteForm
        mode="addendum"
        targetId={parent.id}
        appointmentLabel={formatDateTime(appt.startsAt, locale === 'ar' ? 'ar' : 'en')}
        patientLabel={patientName}
        redirectTo={`${patientsBasePath}/${parent.patientId}`}
      />
    </section>
  );
}
