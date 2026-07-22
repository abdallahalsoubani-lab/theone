import { clinicDayRange, clinicWallParts, clinicWallToInstant } from '@/lib/time/clinic';

/**
 * Clinic-timezone report ranges (Prompt 40 §1.3). All boundaries are computed
 * on the clinic wall clock via the Prompt-31 time module — never the process
 * timezone. `end` is EXCLUSIVE everywhere ([start, end)).
 *
 * Week rule: the Jordanian work week starts on SUNDAY (the clinic's Friday/
 * Saturday are the closed days), so "This week" = Sunday 00:00 → next Sunday.
 */

export type ReportScope = 'today' | 'week' | 'month';

export interface ReportRange {
  start: Date;
  end: Date;
}

export function presetRange(scope: ReportScope, now: Date, timeZone?: string): ReportRange {
  if (scope === 'today') return clinicDayRange(now, timeZone);

  const p = clinicWallParts(now, timeZone);
  if (scope === 'month') {
    const start = clinicWallToInstant({ year: p.year, month: p.month, day: 1 }, timeZone);
    const nextY = p.month === 12 ? p.year + 1 : p.year;
    const nextM = p.month === 12 ? 1 : p.month + 1;
    const end = clinicWallToInstant({ year: nextY, month: nextM, day: 1 }, timeZone);
    return { start, end };
  }

  // week — walk back to the clinic-local Sunday.
  const todayStart = clinicDayRange(now, timeZone).start;
  const weekdayIdx = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0=Sun … 6=Sat, computed from wall DATE parts (TZ-free)
  const start = new Date(todayStart.getTime() - weekdayIdx * 86_400_000);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return { start, end };
}

/**
 * Parse a free from/to pair of clinic-local calendar dates ("YYYY-MM-DD").
 * `to` is INCLUSIVE as typed by the user (a range "01 → 22" includes the
 * 22nd), so the returned exclusive end is the following clinic midnight.
 * Returns null when either date is malformed or the range is inverted.
 */
export function customRange(
  fromDate: string,
  toDate: string,
  timeZone?: string,
): ReportRange | null {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const f = re.exec(fromDate);
  const t = re.exec(toDate);
  if (!f || !t) return null;
  const start = clinicWallToInstant(
    { year: Number(f[1]), month: Number(f[2]), day: Number(f[3]) },
    timeZone,
  );
  const toStart = clinicWallToInstant(
    { year: Number(t[1]), month: Number(t[2]), day: Number(t[3]) },
    timeZone,
  );
  if (toStart.getTime() < start.getTime()) return null;
  return { start, end: new Date(toStart.getTime() + 86_400_000) };
}
