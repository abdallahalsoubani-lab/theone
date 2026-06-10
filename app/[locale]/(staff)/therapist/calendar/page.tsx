import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { deriveDayWindow } from '@/components/calendar/CalendarPageContent';
import { TherapistScheduleBoard } from '@/components/calendar/TherapistScheduleBoard';
import { listAppointmentsForCalendar } from '@/lib/appointments/queries';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Therapist's full schedule (Prompt 15.6) — read-only calendar of their own
 * appointments with day / week / month navigation, so books extending weeks
 * or months ahead are all visible (the dashboard only showed today). Patient
 * names show on every event (no phone — Prompt 15 §1); clicking an event opens
 * the session note or the patient file.
 */
export default async function TherapistCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('appointments.read.assigned');
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  const therapistId = session.user.id;
  const t = await getTranslations('appointments');

  // Generous window: a week back through a year out, so any reasonable future
  // booking date the therapist navigates to has data.
  const from = new Date();
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);
  const to = new Date();
  to.setDate(to.getDate() + 365);
  to.setHours(23, 59, 59, 999);

  const [appointments, settings] = await Promise.all([
    listAppointmentsForCalendar({ from, to, therapistIds: [therapistId] }),
    db.clinicSettings.findUnique({
      where: { id: 'default' },
      select: { businessHours: true },
    }),
  ]);

  // appointmentId → primary session note (for the deep-link destination).
  const notes = await db.sessionNote.findMany({
    where: { appointmentId: { in: appointments.map((a) => a.id) }, parentNoteId: null },
    select: { id: true, appointmentId: true },
  });
  const noteByAppt = new Map(notes.map((n) => [n.appointmentId, n.id]));
  const navById = Object.fromEntries(
    appointments.map((a) => [
      a.id,
      { patientId: a.patientId, sessionNoteId: noteByAppt.get(a.id) },
    ]),
  );

  const { minHour, maxHour } = deriveDayWindow(settings?.businessHours);

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('myScheduleTitle')}</h1>
      <TherapistScheduleBoard
        appointments={appointments}
        minHour={minHour}
        maxHour={maxHour}
        navById={navById}
      />
    </section>
  );
}
