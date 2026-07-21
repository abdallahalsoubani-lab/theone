import { addMinutes } from 'date-fns';
import type { View } from 'react-big-calendar';

import type { CalendarAppointment } from '@/lib/appointments/queries';
import { patientDisplayName } from '@/lib/format/patientName';

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
/** Synthetic day-view lane for therapist-less appointments (July #8 — a
 *  STRETCHING booking has no therapist column). The matching resource is added
 *  in resourcesForView so the lane exists. */
export const OTHER_LANE_ID = '__other__';

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
    patientDisplayName(a.patientFullNameEn, a.patientFullNameAr, locale);
  const end = (a: CalendarAppointment) => addMinutes(a.startsAt, a.durationMinutes);

  if (view === 'day') {
    return appointments.flatMap((a) => {
      // Therapist-less appointments (STRETCHING) have no therapist column —
      // render them once in the synthetic "Other" lane so they don't vanish.
      if (a.therapists.length === 0) {
        return [
          {
            id: a.id,
            title: title(a),
            start: a.startsAt,
            end: end(a),
            resourceId: OTHER_LANE_ID,
            status: a.status,
            appointment: a,
          },
        ];
      }
      return a.therapists.map((th) => ({
        id: `${a.id}::${th.id}`,
        title: title(a),
        start: a.startsAt,
        end: end(a),
        resourceId: th.id,
        status: a.status,
        appointment: a,
      }));
    });
  }

  // Non-day views: one chip per appointment (no resource lanes).
  return appointments.map((a) => ({
    id: a.id,
    title: title(a),
    start: a.startsAt,
    end: end(a),
    resourceId: a.therapists[0]?.id ?? OTHER_LANE_ID,
    status: a.status,
    appointment: a,
  }));
}
