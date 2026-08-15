import { formatDate, formatTime } from '@/lib/format/date';
import { patientDisplayName } from '@/lib/format/patientName';

/**
 * Localized one-line description of a conflict-engine finding. Shared by the
 * single-booking modal's live preview and the batch modal's per-row
 * highlight (July 31 item 4) so both name the busy therapist / room /
 * patient identically. Extracted verbatim from CreateAppointmentModal.
 */

interface Person {
  fullNameEn: string;
  fullNameAr: string;
}

type ConflictType =
  | {
      kind: 'THERAPIST_OVERLAP';
      therapist: Person;
      appointment: {
        patient: Person | null;
        appointmentType: string;
        title: string | null;
        startsAt: Date;
      };
    }
  | {
      kind: 'PATIENT_OVERLAP';
      appointment: { therapists: Person[]; startsAt: Date };
    }
  | { kind: 'THERAPIST_ON_LEAVE'; therapist: Person }
  | {
      kind: 'OUTSIDE_BUSINESS_HOURS';
      reason: 'before_open' | 'after_close' | 'end_exceeds_close';
      openTime: string;
      closeTime: string;
    }
  | { kind: 'CLINIC_CLOSED_THIS_DAY' }
  | { kind: 'ROOM_AT_CAPACITY'; roomName: string; bedCount: number }
  | { kind: 'ROOM_BLOCKED_BY_EVENT'; roomName: string; event: { title: string | null } };

function nm(p: Person, _locale: string): string {
  return patientDisplayName(p.fullNameEn, p.fullNameAr);
}

/** Clinic-local, localized "{date} {time}" for a clashing appointment — the
 *  R-22 messages name the existing appointment's time, not a raw ISO string. */
function fmtClashTime(startsAt: Date | string, locale: string): string {
  const l = locale === 'ar' ? ('ar' as const) : ('en' as const);
  const d = new Date(startsAt);
  return `${formatDate(d, l)} ${formatTime(d, l)}`;
}

export function describeConflict(
  c: unknown,
  t: (key: string, params?: Record<string, string>) => string,
  locale: string,
): string {
  const conflict = c as ConflictType;
  switch (conflict.kind) {
    case 'THERAPIST_OVERLAP':
      // The clashing booking may be a patient-less EVENT — say "in an event"
      // (July #8) instead of naming a (null) patient.
      if (conflict.appointment.appointmentType === 'EVENT') {
        return t('therapistInEvent', {
          therapist: nm(conflict.therapist, locale),
          event: conflict.appointment.title ?? '',
          time: fmtClashTime(conflict.appointment.startsAt, locale),
        });
      }
      return t('therapistOverlap', {
        therapist: nm(conflict.therapist, locale),
        patient: conflict.appointment.patient ? nm(conflict.appointment.patient, locale) : '',
        time: fmtClashTime(conflict.appointment.startsAt, locale),
      });
    case 'PATIENT_OVERLAP':
      return t('patientOverlap', {
        therapist: conflict.appointment.therapists
          .map((th) => nm(th, locale))
          .join(locale === 'ar' ? '، ' : ', '),
        time: fmtClashTime(conflict.appointment.startsAt, locale),
      });
    case 'THERAPIST_ON_LEAVE':
      return t('therapistOnLeave', { therapist: nm(conflict.therapist, locale) });
    case 'OUTSIDE_BUSINESS_HOURS':
      return t(outsideHoursKey(conflict.reason), {
        open: conflict.openTime,
        close: conflict.closeTime,
      });
    case 'CLINIC_CLOSED_THIS_DAY':
      return t('clinicClosedThisDay');
    case 'ROOM_AT_CAPACITY':
      return t('roomAtCapacity', {
        room: conflict.roomName,
        beds: String(conflict.bedCount),
      });
    case 'ROOM_BLOCKED_BY_EVENT':
      return t('roomBlockedByEvent', {
        room: conflict.roomName,
        event: conflict.event.title ?? '',
      });
  }
}

/** Map a working-hours reason to its localized message key. */
function outsideHoursKey(reason: 'before_open' | 'after_close' | 'end_exceeds_close'): string {
  switch (reason) {
    case 'before_open':
      return 'beforeOpen';
    case 'after_close':
      return 'afterClose';
    case 'end_exceeds_close':
      return 'endExceedsClose';
  }
}
