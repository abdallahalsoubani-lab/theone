import { addMinutes } from 'date-fns';
import type { View } from 'react-big-calendar';

import type { CalendarAppointment } from '@/lib/appointments/queries';
import { patientDisplayName } from '@/lib/format/patientName';
import { toClinicWall } from '@/lib/time/clinic';

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
  /**
   * CLINIC-WALL representation (Prompt 31 / P-8): react-big-calendar positions
   * events by the browser-LOCAL fields of these Dates, so they are pre-shifted
   * with `toClinicWall` — the grid shows clinic time on ANY machine (identity
   * shift when the browser is already on Asia/Amman). The true instant lives
   * on `appointment.startsAt`; interaction handlers convert grid Dates back
   * with `fromClinicWall` before touching the server.
   */
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
  // Name-first chips (Prompt 55 §2 — clinic request, reversing the P38 NI-10
  // time prefix): "ما بدها الساعة تطلع عالحجز — بتقرأها من السطور". The grid
  // rows carry the hour; the patient name is the headline. EVENT keeps its
  // label; GROUP keeps label + member count.
  const title = (a: CalendarAppointment) => {
    if (a.appointmentType === 'EVENT') return (a.title ?? '').trim();
    // GROUP (July #8 part 3): the workshop label when set, else the first
    // member's name; the member count is appended so the chip reads as a group.
    if (a.appointmentType === 'GROUP') {
      const first = a.groupPatients[0];
      const base =
        a.title ?? (first ? patientDisplayName(first.fullNameEn, first.fullNameAr, locale) : '');
      return a.groupPatients.length > 0 ? `${base} (${a.groupPatients.length})` : base;
    }
    return patientDisplayName(a.patientFullNameEn, a.patientFullNameAr, locale);
  };
  const start = (a: CalendarAppointment) => toClinicWall(a.startsAt);
  const end = (a: CalendarAppointment) => addMinutes(start(a), a.durationMinutes);

  if (view === 'day') {
    return appointments.flatMap((a) => {
      // Therapist-less appointments (STRETCHING) have no therapist column —
      // render them once in the synthetic "Other" lane so they don't vanish.
      if (a.therapists.length === 0) {
        return [
          {
            id: a.id,
            title: title(a),
            start: start(a),
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
        start: start(a),
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
    start: start(a),
    end: end(a),
    resourceId: a.therapists[0]?.id ?? OTHER_LANE_ID,
    status: a.status,
    appointment: a,
  }));
}

/**
 * What the in-grid card shows (Prompt 55 §2): the chip title (patient name /
 * EVENT label / GROUP label) plus the booking note — nothing else. The time
 * lives in the grid rows; the therapist is the resource column. Pure so the
 * card contract unit-tests without React.
 */
export interface EventCardContent {
  primary: string;
  note: string | null;
}

export function eventCardContent(event: {
  title: string;
  appointment?: CalendarAppointment;
}): EventCardContent {
  const raw = event.appointment?.notes ?? null;
  const trimmed = raw?.trim() ?? '';
  return { primary: event.title, note: trimmed.length > 0 ? trimmed : null };
}
