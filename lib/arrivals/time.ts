/**
 * Clinic-local "today" boundaries for the arrivals system (Prompt 18).
 *
 * "Today" must be the clinic's local day, not the UTC day — otherwise a
 * check-in just after midnight Amman (UTC+3) would fall on the wrong calendar
 * day. We resolve the zone offset via `Intl` so this stays correct even if the
 * clinic timezone ever changes from the fixed UTC+3 Jordan currently uses.
 *
 * Pure + dependency-free so it can be unit-tested and imported by both the
 * worker-safe query layer and server actions.
 */

/** Milliseconds the given zone is ahead of UTC at `date` (Amman → +3h). */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  // `hour` can come back as "24" at midnight in some engines — normalise.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // Drop sub-second precision on the source so the difference is whole-second.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The [start, end) UTC instants bounding the clinic-local calendar day that
 * contains `now`. `end` is exclusive (next local midnight).
 */
export function clinicDayRange(now: Date, timeZone: string): { start: Date; end: Date } {
  const offsetMs = tzOffsetMs(now, timeZone);
  // Local wall-clock Y-M-D for `now`.
  const local = new Date(now.getTime() + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  // Local midnight expressed back in UTC.
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0) - offsetMs);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}
