import { dayKeyOfDate } from './batch-validation';
import type { DayKey } from './conflicts-time';

/**
 * P64 #13 — per-row «كرّر» in the multi-appointment modal. The owner wanted
 * the old "repeat weekly" convenience back WITHOUT re-introducing hidden
 * recurrence: a repeat simply EXPANDS into explicit rows the secretary can
 * still see, edit or delete one by one (July-31 design: rows are the truth).
 *
 * Given a source row's date, the chosen weekdays and a number of weeks, this
 * returns the dates of the copies — every selected weekday in the `weeks`
 * seven-day blocks that FOLLOW the source date (the source itself is never
 * duplicated). Closed clinic days are skipped, and the result is truncated to
 * `room` (what is left under the 30-row cap); `truncated` tells the UI.
 */
export const MAX_REPEAT_WEEKS = 12;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function expandRepeatDates(args: {
  sourceDate: string;
  weekdays: ReadonlyArray<DayKey>;
  weeks: number;
  closedDays: ReadonlyArray<DayKey>;
  /** Rows still allowed under the batch cap. */
  room: number;
}): { dates: string[]; truncated: boolean } {
  if (!dayKeyOfDate(args.sourceDate)) return { dates: [], truncated: false };
  const weeks = Math.max(0, Math.min(MAX_REPEAT_WEEKS, Math.floor(args.weeks)));
  const wanted = new Set(args.weekdays);
  const closed = new Set(args.closedDays);
  const all: string[] = [];
  for (let offset = 1; offset <= weeks * 7; offset++) {
    const date = addDays(args.sourceDate, offset);
    const key = dayKeyOfDate(date)!;
    if (wanted.has(key) && !closed.has(key)) all.push(date);
  }
  const room = Math.max(0, args.room);
  return { dates: all.slice(0, room), truncated: all.length > room };
}
