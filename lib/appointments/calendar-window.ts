import { clinicDaySpan } from '@/lib/time/clinic';

/**
 * Calendar fetch window (P64 #1 — "past appointments disappear").
 *
 * The calendar pages used to load a fixed window around TODAY (−7…+21 days),
 * while navigation was client-only — so stepping back past last week showed
 * an empty grid even though every appointment was still in the database.
 *
 * Now the viewed date + view live in the URL (`?date=YYYY-MM-DD&view=week`,
 * CLAUDE.md "searchParams are the durable state") and the server fetches the
 * window around THAT date, sized to the view so the payload stays like it was.
 * There is no lookback limit.
 */

export const CALENDAR_VIEWS = ['day', 'week', 'month', 'agenda'] as const;
export type CalendarViewParam = (typeof CALENDAR_VIEWS)[number];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A valid `YYYY-MM-DD` calendar date, or null. */
export function parseCalendarDateParam(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d ||
    y < 2000 ||
    y > 2100
  ) {
    return null;
  }
  return value;
}

export function parseCalendarViewParam(value: string | undefined | null): CalendarViewParam | null {
  return value && (CALENDAR_VIEWS as readonly string[]).includes(value)
    ? (value as CalendarViewParam)
    : null;
}

/**
 * An instant INSIDE the clinic day named by `dateKey`: 12:00 UTC, i.e. the
 * afternoon in Amman — safely inside the same clinic day for any UTC−11…+11
 * clinic zone, which is all `clinicDaySpan` needs as an anchor.
 */
export function anchorInstantForDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** Days fetched before / after the anchor, per view (covers what rbc draws). */
const SPAN_BY_VIEW: Record<CalendarViewParam, { before: number; after: number }> = {
  // Day + week keep the original −7…+21 window, so stepping a few days or a
  // week either way needs no wait.
  day: { before: 7, after: 21 },
  week: { before: 7, after: 21 },
  // A month grid starts up to 6 days before the 1st and ends up to 6 days
  // after the last; the anchor can be anywhere in the month.
  month: { before: 38, after: 38 },
  // rbc's agenda lists 30 days from the anchor.
  agenda: { before: 1, after: 31 },
};

export function calendarFetchWindow(
  args: { dateKey: string | null; view: CalendarViewParam | null; now?: Date },
  timeZone?: string,
): { from: Date; to: Date } {
  const anchor = args.dateKey ? anchorInstantForDateKey(args.dateKey) : (args.now ?? new Date());
  const { before, after } = SPAN_BY_VIEW[args.view ?? 'day'];
  const span = clinicDaySpan(anchor, before, after, timeZone);
  // The calendar + leave queries compare with `lte`, so hand back the last
  // instant inside the span rather than its exclusive end.
  return { from: span.start, to: new Date(span.end.getTime() - 1) };
}
