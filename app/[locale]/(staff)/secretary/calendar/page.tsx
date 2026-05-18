import { setRequestLocale } from 'next-intl/server';

import { SecretaryCalendar } from '@/components/calendar/SecretaryCalendar';
import { db } from '@/lib/db';
import { listActiveClinicians, listAppointmentsForCalendar } from '@/lib/appointments/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Secretary's primary working view (replaces the Prompt 4 placeholder).
 *
 * This commit lands the structural shell — the calendar renders with the
 * resource columns, real seeded appointments, and the navigation toolbar.
 * Click handlers (create modal, side panel, drag-and-drop reschedule) are
 * wired in commit 5.
 */
export default async function SecretaryCalendarPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('appointments.read');

  // 14-day window centered on today — covers the default working horizon.
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  from.setHours(0, 0, 0, 0);
  const to = new Date(now);
  to.setDate(to.getDate() + 21);
  to.setHours(23, 59, 59, 999);

  const [appointments, resources, settings] = await Promise.all([
    listAppointmentsForCalendar({ from, to }),
    listActiveClinicians(),
    db.clinicSettings.findUnique({
      where: { id: 'default' },
      select: { businessHours: true },
    }),
  ]);

  const { minHour, maxHour } = deriveDayWindow(settings?.businessHours);

  return (
    <section className="p-4 sm:p-6">
      <SecretaryCalendar
        appointments={appointments}
        resources={resources}
        minHour={minHour}
        maxHour={maxHour}
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
