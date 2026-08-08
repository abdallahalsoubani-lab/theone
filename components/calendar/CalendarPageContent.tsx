import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SecretaryCalendarBoard } from '@/components/calendar/SecretaryCalendarBoard';
import { closedDayKeys } from '@/lib/appointments/closed-days';
import {
  listActiveClinicians,
  listActivePatientsBrief,
  listAppointmentsForCalendar,
} from '@/lib/appointments/queries';
import { db } from '@/lib/db';
import { listApprovedLeavesInRange } from '@/lib/leave/queries';
import { can } from '@/lib/rbac/can';
import { requirePermission } from '@/lib/rbac/guards';
import { clinicDaySpan } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

/**
 * Shared calendar page body (Prompt 15 §2). The same interactive board is the
 * operational hub for Secretary, Admin, and Doctor — all three now have full
 * scheduling parity (drag-to-reschedule, book, cancel). Each role's route
 * renders this so we don't fork a second calendar; permission is enforced
 * here and again in every server action the board calls.
 */
export async function CalendarPageContent({
  locale,
  autoBook,
}: {
  locale: string;
  /** NI-5 (Prompt 41): deep-link from the patient-file "Book doctor visit"
   *  CTA — opens the booking modal prefilled + doctor-scoped. */
  autoBook?: { patientId: string; doctorsOnly: boolean };
}) {
  setRequestLocale(locale);
  // requirePermission resolves the impersonation-aware effective user —
  // chain it so canOverride matches the role RBAC will actually enforce.
  const viewer = await requirePermission('appointments.read');
  const tAppointments = await getTranslations('appointments');

  // Whole CLINIC days (Prompt 31): the process runs on UTC, so `setHours` day
  // math would anchor the window to 03:00 Amman and clip the clinic day.
  const span = clinicDaySpan(new Date(), 7, 21, await getClinicTimeZone());
  const from = span.start;
  // The calendar + leave queries compare with `lte`, so pass the last instant
  // inside the span rather than its exclusive end.
  const to = new Date(span.end.getTime() - 1);

  const [appointments, resources, patients, rooms, settings, leaves] = await Promise.all([
    listAppointmentsForCalendar({ from, to }),
    listActiveClinicians(),
    listActivePatientsBrief(),
    db.room.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.clinicSettings.findUnique({
      where: { id: 'default' },
      select: { businessHours: true, defaultAppointmentDuration: true },
    }),
    listApprovedLeavesInRange(from, to),
  ]);

  const { minHour, maxHour } = deriveDayWindow(settings?.businessHours);
  // Non-working days (Prompt 22 §4.2) — greyed out in the series weekday
  // picker. The conflict engine (CLINIC_CLOSED_THIS_DAY, hard-blocked)
  // remains the server-side authority.
  const closedDays = closedDayKeys(settings?.businessHours);
  const defaultDurationMinutes = settings?.defaultAppointmentDuration ?? 60;
  const canOverride = can(viewer, 'appointments.override_conflict');

  return (
    <section className="p-4 sm:p-6">
      <SecretaryCalendarBoard
        appointments={appointments}
        resources={resources}
        leaves={leaves}
        patients={patients}
        rooms={rooms}
        defaultDurationMinutes={defaultDurationMinutes}
        minHour={minHour}
        maxHour={maxHour}
        closedDays={closedDays}
        canOverride={canOverride}
        newAppointmentLabel={tAppointments('newAppointment')}
        // The board serves Admin, Secretary, and Doctor — patient-file links
        // must stay inside the VIEWER's interface (A-19), and the effective
        // role keeps Act-As consistent too.
        viewerRole={viewer.role}
        autoBook={autoBook}
      />
    </section>
  );
}

interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

export function deriveDayWindow(hoursPayload: unknown): { minHour: number; maxHour: number } {
  const fallback = { minHour: 8, maxHour: 20 };
  if (!hoursPayload || typeof hoursPayload !== 'object') return fallback;
  const hours = hoursPayload as Record<string, DayHours>;
  let minHour = 23;
  let maxHour = 1;
  for (const day of Object.values(hours)) {
    if (day.closed) continue;
    const o = parseInt(day.open.split(':')[0] ?? '0', 10);
    const c = parseInt(day.close.split(':')[0] ?? '0', 10);
    if (o < minHour) minHour = o;
    if (c > maxHour) maxHour = c;
  }
  if (minHour >= maxHour) return fallback;
  return { minHour, maxHour };
}
