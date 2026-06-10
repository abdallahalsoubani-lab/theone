import { getTranslations, setRequestLocale } from 'next-intl/server';

import { auth } from '@/auth';
import { SecretaryCalendarBoard } from '@/components/calendar/SecretaryCalendarBoard';
import {
  listActiveClinicians,
  listActivePatientsBrief,
  listAppointmentsForCalendar,
} from '@/lib/appointments/queries';
import { db } from '@/lib/db';
import { listApprovedLeavesInRange } from '@/lib/leave/queries';
import { can } from '@/lib/rbac/can';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Shared calendar page body (Prompt 15 §2). The same interactive board is the
 * operational hub for Secretary, Admin, and Doctor — all three now have full
 * scheduling parity (drag-to-reschedule, book, cancel). Each role's route
 * renders this so we don't fork a second calendar; permission is enforced
 * here and again in every server action the board calls.
 */
export async function CalendarPageContent({ locale }: { locale: string }) {
  setRequestLocale(locale);
  await requirePermission('appointments.read');
  const session = await auth();
  const tAppointments = await getTranslations('appointments');

  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);
  const to = new Date(now);
  to.setDate(to.getDate() + 21);
  to.setHours(23, 59, 59, 999);

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
  const defaultDurationMinutes = settings?.defaultAppointmentDuration ?? 30;
  const canOverride = session?.user ? can(session.user, 'appointments.override_conflict') : false;

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
        canOverride={canOverride}
        newAppointmentLabel={tAppointments('newAppointment')}
      />
    </section>
  );
}

interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

function deriveDayWindow(hoursPayload: unknown): { minHour: number; maxHour: number } {
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
