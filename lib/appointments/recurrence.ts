/**
 * Recurrence expansion — pure functions, no DB. Used by the series
 * preview action to enumerate occurrence start times and by the create
 * service to compute the same list before the transactional insert.
 *
 * Scope (Prompt 7b §4.4): a clinician schedules an N-week course on
 * one or more weekdays. Daily / monthly / yearly are out of scope.
 * RRULE compatibility is *not* a goal — the persisted column is
 * `Appointment.seriesId` only; the recurrence rule is recomputed from
 * the input each time and is not stored on the row.
 *
 * The +1d / +1w shift helpers exist so the per-occurrence resolution
 * UI can ask the engine "what would this slot look like one day later?"
 * The engine has no opinion on whether the shifted slot is conflict-free;
 * the caller re-runs the conflict engine on the new slot itself.
 */

export type Weekday = 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

const WEEKDAY_INDEX: Record<Weekday, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export const WEEKDAYS: ReadonlyArray<Weekday> = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export interface RecurrenceRule {
  /** Always 'WEEKLY' for now (Prompt 7b scope). */
  frequency: 'WEEKLY';
  /** N in "every N weeks". 1 = every week, 2 = every other week. */
  interval: number;
  /**
   * Days of the week on which an occurrence falls. The first occurrence
   * is anchored to `firstStartsAt`; subsequent occurrences keep the same
   * time-of-day (in UTC) and land on each listed weekday within the
   * `interval`-week stride.
   */
  byWeekday: Weekday[];
  /** Total number of occurrences to generate, including the first. */
  count: number;
}

export interface PlannedOccurrence {
  /** 0-based index within the originally generated series. Stable across
   *  shift operations so the UI can keep keys consistent. */
  index: number;
  startsAt: Date;
  durationMinutes: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

/** Cap on the number of occurrences a single series can produce. Mirrors the
 *  schema bound; the engine refuses to expand past it to protect the DB
 *  from a runaway count from a typo on the client. */
export const MAX_SERIES_OCCURRENCES = 52;

/**
 * Expand a rule into an ordered list of occurrence start times. The
 * first item always equals `firstStartsAt`. Throws if the rule would
 * exceed MAX_SERIES_OCCURRENCES.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  firstStartsAt: Date,
  durationMinutes: number,
): PlannedOccurrence[] {
  if (rule.count < 1) return [];
  if (rule.count > MAX_SERIES_OCCURRENCES) {
    throw new Error(`Series count ${rule.count} exceeds MAX_SERIES_OCCURRENCES`);
  }
  if (rule.interval < 1) {
    throw new Error('Recurrence interval must be >= 1');
  }
  if (rule.byWeekday.length === 0) {
    throw new Error('byWeekday must include at least one day');
  }

  const anchorWeekday = firstStartsAt.getUTCDay();
  // Normalize to the start of the anchor week (Sunday of week 0) so
  // we can step in fixed `interval * 7` day strides without DST drift —
  // UTC has no DST, which is exactly why we anchor on UTC.
  const weekStart = new Date(firstStartsAt.getTime() - anchorWeekday * ONE_DAY_MS);

  // Filter+sort the configured weekdays so iteration order is stable.
  const days = [...rule.byWeekday]
    .map((w) => WEEKDAY_INDEX[w])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .sort((a, b) => a - b);

  const result: PlannedOccurrence[] = [];
  let weekIdx = 0;
  let index = 0;

  // The first occurrence must equal firstStartsAt exactly. If the
  // anchor weekday isn't in `byWeekday`, prepend it so the user's
  // chosen start is always honored — the rest of the series follows
  // the picked pattern from the next stride.
  const anchorIncluded = days.includes(anchorWeekday);

  while (result.length < rule.count) {
    const baseWeek = new Date(weekStart.getTime() + weekIdx * rule.interval * ONE_WEEK_MS);
    for (const dayOffset of days) {
      const candidate = new Date(baseWeek.getTime() + dayOffset * ONE_DAY_MS);
      candidate.setUTCHours(
        firstStartsAt.getUTCHours(),
        firstStartsAt.getUTCMinutes(),
        firstStartsAt.getUTCSeconds(),
        firstStartsAt.getUTCMilliseconds(),
      );
      if (candidate.getTime() < firstStartsAt.getTime()) continue;
      if (weekIdx === 0 && !anchorIncluded && candidate.getTime() === firstStartsAt.getTime()) {
        // Anchor handled below.
        continue;
      }
      result.push({ index: index++, startsAt: candidate, durationMinutes });
      if (result.length >= rule.count) break;
    }
    if (weekIdx === 0 && !anchorIncluded && result.length < rule.count) {
      result.unshift({ index: index++, startsAt: firstStartsAt, durationMinutes });
      // Adjust stored indices so they remain dense and ordered.
      result.forEach((o, i) => (o.index = i));
    }
    weekIdx++;
    if (weekIdx > MAX_SERIES_OCCURRENCES * 2) {
      // Defensive cap: byWeekday empty after filtering would already
      // have thrown, but bound the loop just in case future rule
      // shapes regress this invariant.
      break;
    }
  }

  return result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).slice(0, rule.count);
}

/** Shift a single occurrence's startsAt by one calendar day forward. */
export function shiftByOneDay(occ: PlannedOccurrence): PlannedOccurrence {
  return { ...occ, startsAt: new Date(occ.startsAt.getTime() + ONE_DAY_MS) };
}

/** Shift a single occurrence's startsAt by one week forward (next pattern occurrence). */
export function shiftByOneWeek(occ: PlannedOccurrence): PlannedOccurrence {
  return { ...occ, startsAt: new Date(occ.startsAt.getTime() + ONE_WEEK_MS) };
}
