import type { LanguagePref } from '@prisma/client';

/**
 * P61 item 1 §1.3.3 — THE clinician name that goes into a template variable.
 *
 * Behaviour is deliberately UNCHANGED from what every sender did before this
 * prompt; the point of the helper is that the rule now lives in ONE file:
 *
 *   1 therapist   → the name in the recipient's language
 *   2+ therapists → the FIRST assigned clinician (the P48 §Item-1 documented
 *                   convention). P61 §1.3.3 proposed joining the names; the
 *                   owner WITHDREW that (Q2) — joining would have rewritten
 *                   every automatic confirmation clinic-wide as a side effect
 *                   of a fix whose symptom was "the section doesn't appear".
 *                   Flipping it later is one line, here.
 *   0 therapists  → a neutral clinic-level label, NEVER an empty string
 *                   (Twilio rejects empty parameters).
 *
 * `appointmentType` only refines the zero-therapist fallback and is optional
 * on purpose: `sendConfirmation` does NOT pass it, because its historical
 * fallback for a therapist-less STRETCHING booking is «فريق العيادة» and the
 * owner asked for byte-identical output. `sendRescheduled` passes it and so
 * keeps its own «جلسة استطالة» wording.
 */

export interface TherapistNameRef {
  fullNameEn: string;
  fullNameAr: string;
}

export interface AppointmentTherapistRef {
  therapist: TherapistNameRef;
}

const CLINIC_TEAM = { AR: 'فريق العيادة', EN: 'the clinic team' } as const;
const STRETCHING_SESSION = { AR: 'جلسة استطالة', EN: 'Stretching session' } as const;

export function getAppointmentTherapistLabel(args: {
  /** Ordered by assignment (`createdAt asc`) — the first one wins. */
  therapists: readonly AppointmentTherapistRef[];
  language: LanguagePref;
  /** Omit to keep the plain clinic-team fallback (see the note above). Typed
   *  loosely because callers hold it as the Prisma enum or as a plain string. */
  appointmentType?: string | null;
}): string {
  const isAr = args.language === 'AR';
  const first = args.therapists[0]?.therapist ?? null;
  if (first) return isAr ? first.fullNameAr : first.fullNameEn;
  if (args.appointmentType === 'STRETCHING') {
    return isAr ? STRETCHING_SESSION.AR : STRETCHING_SESSION.EN;
  }
  return isAr ? CLINIC_TEAM.AR : CLINIC_TEAM.EN;
}
