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

/** P54 — the dedicated single lane for STRETCHING appointments (owner
 *  request): all stretching sessions across all rooms share this one column,
 *  positioned after the therapists and before "Other". */
export const STRETCHING_LANE_ID = '__stretching__';

/** The synthetic (non-therapist) lane ids — used to keep a lane id from ever
 *  being mistaken for a therapist id (e.g. on a drag reassign). */
export const SYNTHETIC_LANE_IDS: ReadonlySet<string> = new Set([OTHER_LANE_ID, STRETCHING_LANE_ID]);

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
      // P54 — STRETCHING gets its own dedicated lane (evaluated BEFORE the
      // no-therapist fallback so it never lands in "Other" again).
      if (a.appointmentType === 'STRETCHING') {
        return [
          {
            id: a.id,
            title: title(a),
            start: start(a),
            end: end(a),
            resourceId: STRETCHING_LANE_ID,
            status: a.status,
            appointment: a,
          },
        ];
      }
      // Other therapist-less appointments (patient-less EVENT, room-only) —
      // render once in the synthetic "Other" lane so they don't vanish.
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

  // Non-day views: one chip per appointment (no resource lanes — resourceId
  // only feeds the chip tint).
  return appointments.map((a) => ({
    id: a.id,
    title: title(a),
    start: start(a),
    end: end(a),
    resourceId:
      a.appointmentType === 'STRETCHING'
        ? STRETCHING_LANE_ID
        : (a.therapists[0]?.id ?? OTHER_LANE_ID),
    status: a.status,
    appointment: a,
  }));
}

/**
 * What the in-grid card shows: the chip title ONLY (patient name / EVENT
 * label / GROUP label), plus the booking note.
 *
 * NO time on the card — owner request (24 Aug 2026), reversing PT-B3 item 3
 * and restoring Prompt 55 §2's name-only card: the grid rows already give
 * the hour, and the name is what the secretary scans for. The exact time
 * stays one hover (tooltip) or click (side panel) away.
 * Pure so the card contract unit-tests without React.
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
  return {
    primary: event.title,
    note: trimmed.length > 0 ? trimmed : null,
  };
}

// ─── P54 — pure lane helpers (unit-tested; the calendar/board consume them) ──

export interface CalendarLane {
  resourceId: string;
  resourceTitle: string;
}

/**
 * Assemble the day-view resource lanes in the owner's order:
 *   [therapists…] [استطالة] [أخرى]
 * The stretching lane appears only when a stretching booking exists; "Other"
 * only when a non-stretching therapist-less booking exists.
 */
export function buildCalendarLanes(
  therapistLanes: CalendarLane[],
  opts: {
    hasStretching: boolean;
    hasOther: boolean;
    stretchingLabel: string;
    otherLabel: string;
  },
): CalendarLane[] {
  const lanes = [...therapistLanes];
  if (opts.hasStretching) {
    lanes.push({ resourceId: STRETCHING_LANE_ID, resourceTitle: opts.stretchingLabel });
  }
  if (opts.hasOther) {
    lanes.push({ resourceId: OTHER_LANE_ID, resourceTitle: opts.otherLabel });
  }
  return lanes;
}

export type DropDecision =
  | { kind: 'ok'; reassignLaneId?: string }
  | { kind: 'reject-stretching-to-therapist' }
  | { kind: 'reject-into-stretching' };

/**
 * The cross-lane drop rule (owner decision 4): a drag never changes an
 * appointment's TYPE.
 *   - a STRETCHING chip may only move within its own lane → any other target
 *     is rejected; within-lane is a time-only move (no reassign);
 *   - a non-stretching chip dropped INTO the stretching lane is rejected;
 *   - a synthetic lane id (stretching/other) is never a therapist, so it is
 *     never returned as a reassign target — only a real therapist id is.
 */
export function resolveDrop(
  appointmentType: string,
  targetLaneId: string | undefined,
): DropDecision {
  const isStretching = appointmentType === 'STRETCHING';
  if (isStretching) {
    if (targetLaneId && targetLaneId !== STRETCHING_LANE_ID) {
      return { kind: 'reject-stretching-to-therapist' };
    }
    return { kind: 'ok' };
  }
  if (targetLaneId === STRETCHING_LANE_ID) return { kind: 'reject-into-stretching' };
  const reassignLaneId =
    targetLaneId && SYNTHETIC_LANE_IDS.has(targetLaneId) ? undefined : targetLaneId;
  return { kind: 'ok', reassignLaneId };
}
