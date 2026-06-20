/**
 * Working-hours validation — the SINGLE source of truth for whether an
 * appointment's start/end fall inside the clinic's open window for the day.
 *
 * The crux (the bug this module fixes): clinic hours are stored as local
 * wall-clock `"HH:MM"` strings in the clinic timezone (Asia/Amman, UTC+3),
 * but `Appointment.startsAt` is a UTC instant. Extracting the hour with
 * `getUTCHours()` compares a UTC clock against a local cutoff and is wrong by
 * the zone offset — a 09:00 Amman booking reads as 06:00 and looks "before
 * open". Every comparison here is done in clinic-local wall-clock time.
 *
 * Pure + dependency-free (reuses the already-tested `tzOffsetMs` from the
 * arrivals time helpers, Prompt 18) so single + recurring + reschedule paths
 * and the unit tests all share one implementation.
 *
 * Edge rule (stated in the PR): close is INCLUSIVE as an end boundary — an
 * appointment ending exactly at close (e.g. 17:30→18:00) is valid; one
 * STARTING exactly at close (18:00) is invalid because the clinic is closing.
 */

import { tzOffsetMs } from '@/lib/arrivals/time';

import { DAY_KEYS, type DayKey } from './conflicts-time';

export const CLINIC_DEFAULT_TZ = 'Asia/Amman';

export interface DayHours {
  open: string; // "HH:MM" clinic-local
  close: string; // "HH:MM" clinic-local
  closed: boolean;
}

export interface WorkingHoursSettings {
  /** Per-weekday open/close, clinic-local. `null` = unconfigured (skip check). */
  hours: Record<DayKey, DayHours> | null;
  /** IANA zone the `hours` strings are expressed in (e.g. "Asia/Amman"). */
  timeZone: string;
}

export type WorkingHoursReason = 'before_open' | 'after_close' | 'end_exceeds_close';

export type WorkingHoursResult =
  | { ok: true }
  | {
      ok: false;
      reason: WorkingHoursReason;
      openTime: string;
      closeTime: string;
      dayKey: DayKey;
    };

/** Parse "HH:MM" into minutes past midnight. */
function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(':').map((n) => parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Clinic-local wall-clock of `instant`, as `{ dayKey, minutesOfDay }`. */
function localWallClock(instant: Date, timeZone: string): { dayKey: DayKey; minutesOfDay: number } {
  const wall = new Date(instant.getTime() + tzOffsetMs(instant, timeZone));
  return {
    dayKey: DAY_KEYS[wall.getUTCDay()] as DayKey,
    minutesOfDay: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
  };
}

/** The clinic-local weekday key for an instant (e.g. for closed-day lookup). */
export function localDayKey(instant: Date, timeZone: string): DayKey {
  return localWallClock(instant, timeZone).dayKey;
}

/**
 * Validate an appointment's [start, end) against the clinic's open window for
 * the start's local day. Returns `{ ok: true }` when hours are unconfigured or
 * the day is marked closed (closed-day rejection is the conflict engine's
 * concern, not this time-window check).
 *
 * Both ends are validated:
 *   - start before open            → `before_open`
 *   - start at/after close         → `after_close`   (clinic is closing)
 *   - start ok but end after close → `end_exceeds_close`
 * Close is inclusive: end == close is valid; start == open is valid.
 */
export function isWithinWorkingHours(
  start: Date,
  end: Date,
  settings: WorkingHoursSettings,
): WorkingHoursResult {
  if (!settings.hours) return { ok: true };

  const { dayKey, minutesOfDay: startMin } = localWallClock(start, settings.timeZone);
  const day = settings.hours[dayKey];
  if (!day || day.closed) return { ok: true };

  const endMin = localWallClock(end, settings.timeZone).minutesOfDay;
  const openMin = hhmmToMinutes(day.open);
  const closeMin = hhmmToMinutes(day.close);

  const fail = (reason: WorkingHoursReason): WorkingHoursResult => ({
    ok: false,
    reason,
    openTime: day.open,
    closeTime: day.close,
    dayKey,
  });

  if (startMin < openMin) return fail('before_open');
  if (startMin >= closeMin) return fail('after_close');
  if (endMin > closeMin) return fail('end_exceeds_close');
  return { ok: true };
}
