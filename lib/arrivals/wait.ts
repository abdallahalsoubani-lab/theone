import { clinicHm } from '@/lib/time/clinic';

/**
 * What the kiosk tells a patient after they check in (PT-B5 item 3).
 *
 * It used to echo `ClinicSettings.currentDelayMinutes` — one clinic-wide
 * number the secretary sets — regardless of when the patient's appointment
 * actually was. That is why the reported cases all read wrong: at 3:50 for a
 * 4:00 appointment it said "~5 minutes" (the stepper's value), said the same
 * "5" at 3:53 for a 4:30 appointment, and told someone whose 1:00 appointment
 * had passed four hours earlier that their turn was in 45 minutes.
 *
 * The wait is now the real gap between now and the appointment. Pure and
 * `now`-injected, so it is computed on the SERVER — a kiosk tablet's clock is
 * not something to trust — and unit-tested without one.
 */

/** Past this many minutes late, the patient is sent to reception rather than
 *  given a countdown. Generous enough to cover a normal late arrival. */
export const LATE_GRACE_MINUTES = 15;

/** Within this many minutes of the slot, say "it's your turn" instead of
 *  counting down to it. */
const IMMINENT_MINUTES = 2;

/** Displayed waits are rounded to this — the patient wants "about ten
 *  minutes", not "eleven". */
const ROUND_TO_MINUTES = 5;

export type KioskWait =
  /** The appointment is now (or within a couple of minutes). */
  | { kind: 'NOW' }
  /** `minutes` is already rounded for display and is always >= 5. */
  | { kind: 'WAIT'; minutes: number }
  /** More than the grace past the start. `scheduledHm` is the clinic-local
   *  "HH:MM" of the appointment, so the message can name it. */
  | { kind: 'OVERDUE'; scheduledHm: string };

/**
 * Whole minutes from `now` until `startsAt` — negative once the slot has
 * started. Instant-vs-instant, so it is timezone-independent; only the
 * OVERDUE message needs the clinic clock, for the time it prints.
 */
export function minutesUntil(now: Date, startsAt: Date): number {
  return Math.round((startsAt.getTime() - now.getTime()) / 60_000);
}

export function kioskWait(now: Date, startsAt: Date, timeZone?: string): KioskWait {
  const until = minutesUntil(now, startsAt);

  if (until < -LATE_GRACE_MINUTES) {
    return { kind: 'OVERDUE', scheduledHm: clinicHm(startsAt, timeZone) };
  }
  if (until <= IMMINENT_MINUTES) return { kind: 'NOW' };

  // Round to the nearest 5, but never down to 0 — "in about 0 minutes" is not
  // a sentence, and that case is already NOW.
  const rounded = Math.round(until / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;
  return { kind: 'WAIT', minutes: Math.max(ROUND_TO_MINUTES, rounded) };
}
