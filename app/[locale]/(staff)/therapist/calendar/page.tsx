import { getTranslations, setRequestLocale } from 'next-intl/server';

import { deriveDayWindow } from '@/components/calendar/CalendarPageContent';
import { TherapistScheduleBoard } from '@/components/calendar/TherapistScheduleBoard';
import { listAppointmentsForCalendar } from '@/lib/appointments/queries';
import { db } from '@/lib/db';
import { listApprovedLeavesInRange } from '@/lib/leave/queries';
import { requirePermission } from '@/lib/rbac/guards';
import { clinicDaySpan } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

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
  // requirePermission resolves the impersonation-aware effective user —
  // chain it so Act-As shows the impersonated therapist's schedule
  // (Prompt 22 §3.2).
  const viewer = await requirePermission('appointments.read.assigned');
  const therapistId = viewer.id;
  const t = await getTranslations('appointments');

  // Generous window: a week back through a year out, so any reasonable future
  // booking date the therapist navigates to has data. Boundaries are CLINIC
  // days (Prompt 31) — the process runs on UTC, so day math must not use the
  // local getters or the window starts at 03:00 Amman.
  const span = clinicDaySpan(new Date(), 7, 365, await getClinicTimeZone());
  const from = span.start;
  // listAppointmentsForCalendar / listApprovedLeavesInRange compare with `lte`,
  // so pass the last instant inside the span rather than its exclusive end.
  const to = new Date(span.end.getTime() - 1);

  const [appointments, settings, allLeaves] = await Promise.all([
    listAppointmentsForCalendar({ from, to, therapistIds: [therapistId] }),
    db.clinicSettings.findUnique({
      where: { id: 'default' },
      select: { businessHours: true },
    }),
    listApprovedLeavesInRange(from, to),
  ]);
  // Own leaves only (Prompt 55 §1): this is a single-clinician board, so a
  // colleague's leave must not gray these columns.
  const leaves = allLeaves.filter((l) => l.userId === therapistId);

  // appointmentId → primary session note (for the deep-link destination).
  const notes = await db.sessionNote.findMany({
    where: { appointmentId: { in: appointments.map((a) => a.id) }, parentNoteId: null },
    select: { id: true, appointmentId: true },
  });
  const noteByAppt = new Map(notes.map((n) => [n.appointmentId, n.id]));
  const navById = Object.fromEntries(
    appointments.map((a) => [
      a.id,
      { patientId: a.patientId ?? '', sessionNoteId: noteByAppt.get(a.id) },
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
        leaves={leaves}
      />
    </section>
  );
}
