import { addMinutes } from 'date-fns';
import type { View } from 'react-big-calendar';

import type { CalendarAppointment } from '@/lib/appointments/queries';

/**
 * Maps appointments to react-big-calendar events, VIEW-AWARE (Calendar overlap
 * fix, Option ②).
 *
 * - Day view has per-therapist resource columns, so a session is fanned into
 *   one event per therapist (composite id keeps React keys unique per lane);
 *   each chip lands in its therapist's column.
 * - Week / month / agenda have NO resource columns, so a multi-therapist
 *   session must collapse to ONE event — otherwise it renders as N duplicate
 *   chips piled at the same time in a single day column. `resourceId` is the
 *   first therapist so the existing card derives its tint + "+N" co-therapist
 *   hint with no extra plumbing.
 *
 * Pure (only `date-fns` + a type-only rbc import) so it unit-tests without React
 * or the calendar runtime.
 */
export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  status?: CalendarAppointment['status'];
  appointment?: CalendarAppointment;
}

export function eventsForView(
  appointments: CalendarAppointment[],
  view: View,
  locale: string,
): CalendarEvent[] {
  const title = (a: CalendarAppointment) =>
    locale === 'ar' ? a.patientFullNameAr : a.patientFullNameEn;
  const end = (a: CalendarAppointment) => addMinutes(a.startsAt, a.durationMinutes);

  if (view === 'day') {
    return appointments.flatMap((a) =>
      a.therapists.map((th) => ({
        id: `${a.id}::${th.id}`,
        title: title(a),
        start: a.startsAt,
        end: end(a),
        resourceId: th.id,
        status: a.status,
        appointment: a,
      })),
    );
  }

  // Non-day views: one chip per appointment (no resource lanes).
  return appointments.map((a) => ({
    id: a.id,
    title: title(a),
    start: a.startsAt,
    end: end(a),
    resourceId: a.therapists[0]?.id ?? '',
    status: a.status,
    appointment: a,
  }));
}
