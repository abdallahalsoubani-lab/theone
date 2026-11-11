import { getTranslations, setRequestLocale } from 'next-intl/server';

import { deriveDayWindow } from '@/components/calendar/CalendarPageContent';
import { TherapistScheduleBoard } from '@/components/calendar/TherapistScheduleBoard';
import {
  calendarFetchWindow,
  parseCalendarDateParam,
  parseCalendarViewParam,
} from '@/lib/appointments/calendar-window';
import { listActiveClinicians, listAppointmentsForCalendar } from '@/lib/appointments/queries';
import { db } from '@/lib/db';
import { listApprovedLeavesInRange } from '@/lib/leave/queries';
import { requirePermission } from '@/lib/rbac/guards';
import { grantedOwnerIds } from '@/lib/schedule-grants/queries';
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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  // requirePermission resolves the impersonation-aware effective user —
  // chain it so Act-As shows the impersonated therapist's schedule
  // (Prompt 22 §3.2).
  const viewer = await requirePermission('appointments.read.assigned');
  const therapistId = viewer.id;
  const t = await getTranslations('appointments');

  // P64 #1 — the window follows the VIEWED date in the URL (any past or
  // future week), CLINIC-day aligned (Prompt 31).
  const dateKey = parseCalendarDateParam(sp.date);
  const view = parseCalendarViewParam(sp.view);
  const { from, to } = calendarFetchWindow({ dateKey, view }, await getClinicTimeZone());

  // P64 #4 — colleagues whose schedules Admin/Secretary let this therapist
  // SEE (read-only). With none, the board is exactly the single-clinician
  // view it always was.
  const ownerIds = await grantedOwnerIds(therapistId);
  const visibleIds = [therapistId, ...ownerIds];

  const [appointments, settings, allLeaves, clinicians] = await Promise.all([
    listAppointmentsForCalendar({ from, to, therapistIds: visibleIds }),
    db.clinicSettings.findUnique({
      where: { id: 'default' },
      select: { businessHours: true },
    }),
    listApprovedLeavesInRange(from, to),
    listActiveClinicians(),
  ]);
  // Leaves of the clinicians ON this board only (Prompt 55 §1): own, plus a
  // granted colleague's (their lane grays) — never anyone else's.
  const visible = new Set(visibleIds);
  const leaves = allLeaves.filter((l) => visible.has(l.userId));
  // One lane per visible clinician (self first) only when grants exist.
  const byId = new Map(clinicians.map((c) => [c.id, c]));
  const resources =
    ownerIds.length > 0
      ? visibleIds.flatMap((id) => {
          const c = byId.get(id);
          return c ? [{ id: c.id, fullNameEn: c.fullNameEn, fullNameAr: c.fullNameAr }] : [];
        })
      : [];

  // appointmentId → primary session note (for the deep-link destination).
  const notes = await db.sessionNote.findMany({
    where: { appointmentId: { in: appointments.map((a) => a.id) }, parentNoteId: null },
    select: { id: true, appointmentId: true },
  });
  const noteByAppt = new Map(notes.map((n) => [n.appointmentId, n.id]));
  // Only the therapist's OWN appointments navigate (note / patient file); a
  // granted colleague's cards are look-only — no access to those files.
  const navById = Object.fromEntries(
    appointments
      .filter((a) => a.therapists.some((th) => th.id === therapistId))
      .map((a) => [a.id, { patientId: a.patientId ?? '', sessionNoteId: noteByAppt.get(a.id) }]),
  );

  const { minHour, maxHour } = deriveDayWindow(settings?.businessHours);

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('myScheduleTitle')}</h1>
      <TherapistScheduleBoard
        appointments={appointments}
        initialDateKey={dateKey}
        initialView={view}
        minHour={minHour}
        maxHour={maxHour}
        navById={navById}
        leaves={leaves}
        resources={resources}
        tintIds={clinicians.map((c) => c.id)}
      />
    </section>
  );
}
