/**
 * Closed-day derivation from `ClinicSettings.businessHours` (Prompt 22 §4.2).
 *
 * The JSON column stores per-weekday `{ open, close, closed }` objects keyed
 * by `DayKey` ('sun'…'sat'). This helper distils that payload into the list
 * of non-working days so the booking UIs can grey out closed weekdays
 * (e.g. the series weekday picker) without re-deriving hours logic.
 *
 * Defensive by design: the column is admin-editable JSON, so `null`,
 * non-object, or malformed payloads all yield `[]` — the UI then simply
 * offers every weekday and the conflict engine (CLINIC_CLOSED_THIS_DAY,
 * hard-blocked) remains the authority server-side.
 */

import { DAY_KEYS, type DayKey } from './conflicts-time';
import type { Weekday } from './recurrence';

/** Recurrence `Weekday` ('SUN'…'SAT') → settings `DayKey` ('sun'…'sat'). */
const WEEKDAY_TO_DAY_KEY: Record<Weekday, DayKey> = {
  SUN: 'sun',
  MON: 'mon',
  TUE: 'tue',
  WED: 'wed',
  THU: 'thu',
  FRI: 'fri',
  SAT: 'sat',
};

export function weekdayToDayKey(weekday: Weekday): DayKey {
  return WEEKDAY_TO_DAY_KEY[weekday];
}

/**
 * Days marked `closed: true` in a `businessHours` payload, in week order
 * (sun…sat). Null / non-object / malformed payloads → `[]`.
 */
export function closedDayKeys(businessHours: unknown): DayKey[] {
  if (!businessHours || typeof businessHours !== 'object' || Array.isArray(businessHours)) {
    return [];
  }
  const hours = businessHours as Record<string, unknown>;
  return DAY_KEYS.filter((key) => {
    const day = hours[key];
    return (
      typeof day === 'object' &&
      day !== null &&
      !Array.isArray(day) &&
      (day as { closed?: unknown }).closed === true
    );
  });
}
