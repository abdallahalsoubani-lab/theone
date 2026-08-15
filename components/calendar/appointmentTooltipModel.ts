import { addMinutes } from 'date-fns';

import type { CalendarAppointment } from '@/lib/appointments/queries';
import { patientDisplayName } from '@/lib/format/patientName';
import { clinicHm } from '@/lib/time/clinic';

/**
 * Hover-tooltip content model (Prompt 56). Pure: built ONLY from the event
 * payload the viewer's feed already carries — zero extra queries. The phone
 * field mirrors the P15 boundary: it is whatever `patientPhone` the feed
 * shipped (Secretary/Admin get it, Doctor/Therapist get null) — this module
 * never widens it.
 */

export interface AppointmentTooltipModel {
  /** Patient display name (locale-first) / EVENT title / GROUP label. */
  primary: string;
  /** The OTHER script of the patient name when both exist and differ. */
  secondary: string | null;
  /** GROUP/WORKSHOP member names (locale script) — empty otherwise. */
  groupMembers: string[];
  /** Clinic-wall range, e.g. "12:00–12:45" (Latin digits, LTR). */
  timeRange: string;
  durationMinutes: number;
  /** ALL therapists on the session (locale script). */
  therapists: string[];
  room: string | null;
  /** i18n key under `appointments.form`. */
  typeKey: 'typeSession' | 'typeStretching' | 'typeEvent' | 'typeGroup';
  /** i18n key under `appointments.status`. */
  statusKey: 'scheduled' | 'confirmed' | 'inProgress' | 'completed' | 'cancelled' | 'noShow';
  /** Full booking note, untrimmed length — the tooltip never truncates it. */
  note: string | null;
  /** Render-if-present ONLY (P15): null whenever the feed stripped it. */
  phone: string | null;
}

const STATUS_KEYS: Record<CalendarAppointment['status'], AppointmentTooltipModel['statusKey']> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'inProgress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'noShow',
};

// WORKSHOP is the GROUP flavour (Prompt 30) and has no label key of its own —
// it shares the GROUP label + members treatment.
const TYPE_KEYS: Record<
  CalendarAppointment['appointmentType'],
  AppointmentTooltipModel['typeKey']
> = {
  SESSION: 'typeSession',
  STRETCHING: 'typeStretching',
  EVENT: 'typeEvent',
  GROUP: 'typeGroup',
  WORKSHOP: 'typeGroup',
};

export function appointmentTooltipModel(
  a: CalendarAppointment,
  locale: string,
): AppointmentTooltipModel {
  // PATIENT names render English-only (P47 row 8, via the helper); STAFF
  // names keep the locale script — the row-8 removal is patients only.
  const name = (p: { fullNameEn: string; fullNameAr: string }) =>
    patientDisplayName(p.fullNameEn, p.fullNameAr, locale);
  const staffName = (p: { fullNameEn: string; fullNameAr: string }) =>
    locale === 'ar' ? p.fullNameAr : p.fullNameEn;

  const isEvent = a.appointmentType === 'EVENT';
  const isGroupLike = a.appointmentType === 'GROUP' || a.appointmentType === 'WORKSHOP';

  let primary: string;
  const secondary: string | null = null;
  if (isEvent) {
    primary = (a.title ?? '').trim();
  } else if (isGroupLike) {
    const first = a.groupPatients[0];
    primary = a.title ?? (first ? name(first) : '');
  } else {
    primary = name({ fullNameEn: a.patientFullNameEn, fullNameAr: a.patientFullNameAr });
    // P47 row 8 — no other-script secondary line; English is the name.
  }

  const note = a.notes?.trim() ?? '';

  return {
    primary,
    secondary,
    groupMembers: isGroupLike ? a.groupPatients.map(name) : [],
    timeRange: `${clinicHm(a.startsAt)}–${clinicHm(addMinutes(a.startsAt, a.durationMinutes))}`,
    durationMinutes: a.durationMinutes,
    therapists: a.therapists.map(staffName),
    room: a.roomName,
    typeKey: TYPE_KEYS[a.appointmentType],
    statusKey: STATUS_KEYS[a.status],
    note: note.length > 0 ? note : null,
    phone: isEvent ? null : a.patientPhone,
  };
}

/**
 * Decision أ (Prompt 56 §1.2): mouse/desktop only, gated by CAPABILITY —
 * `(hover: hover) and (pointer: fine)` — never by screen width. Pure so it
 * unit-tests in node; the component feeds it `window.matchMedia`.
 */
export function hoverCapable(
  matchMediaFn: ((query: string) => { matches: boolean }) | undefined,
): boolean {
  if (typeof matchMediaFn !== 'function') return false;
  try {
    return matchMediaFn('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}
