/**
 * Clinic-timezone clock math — THE single source of truth (Prompt 31 §4.1).
 *
 * Storage is UTC instants; the clinic operates on Asia/Amman wall-clock. Every
 * piece of code that turns an instant into a wall-clock reading (display
 * strings, "what hour is this", "today" bounds) or a wall-clock entry into an
 * instant must route through here — never through the process/browser
 * timezone (`getHours()`, bare `toLocaleString`, `new Date('YYYY-MM-DDTHH:mm')`
 * parsed server-side) and never through `± 3h` arithmetic, which breaks on
 * DST-observing zones and server moves.
 *
 * Pure + dependency-free (Intl only) so it is importable from client
 * components, server actions, and BullMQ workers alike. The DB-backed zone
 * accessor lives in ./clinic-server.ts; callers without a loaded
 * `ClinicSettings.timezone` fall back to the CLINIC_TIME_ZONE constant.
 *
 * `tzOffsetMs` + `clinicDayRange` moved here from lib/arrivals/time.ts
 * (Prompt 18), which now re-exports them for existing importers.
 */

import { CLINIC_TIME_ZONE } from '@/lib/format/locale';

export { CLINIC_TIME_ZONE };

/** Cached per-zone formatter — this module is called per calendar slot. */
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

/** Clinic-local wall-clock fields of an instant. Month is 1-based. */
export interface ClinicWallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The clinic wall-clock reading of `instant`. */
export function clinicWallParts(
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): ClinicWallParts {
  const parts = Object.fromEntries(
    wallFormatter(timeZone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `hour` can come back as "24" at midnight in some engines — normalise.
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Milliseconds the given zone is ahead of UTC at `date` (Amman → +3h). */
export function tzOffsetMs(date: Date, timeZone: string = CLINIC_TIME_ZONE): number {
  const p = clinicWallParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second precision on the source so the difference is whole-second.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * The [start, end) UTC instants bounding the clinic-local calendar day that
 * contains `now`. `end` is exclusive (next local midnight).
 */
export function clinicDayRange(
  now: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): { start: Date; end: Date } {
  const p = clinicWallParts(now, timeZone);
  const start = clinicWallToInstant({ year: p.year, month: p.month, day: p.day }, timeZone);
  const end = new Date(start.getTime() + 86_400_000);
  return { start, end };
}

/** Clinic-local calendar date of an instant — "YYYY-MM-DD". */
export function clinicDateKey(instant: Date, timeZone: string = CLINIC_TIME_ZONE): string {
  const p = clinicWallParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Clinic-local 24h clock reading of an instant — "HH:MM". */
/**
 * Localized weekday name of an instant in CLINIC wall time (Prompt 48b —
 * the {{dayName}} template variable). Computed with the clinic timeZone
 * pinned INSIDE Intl (institutional rule #1: never feed a wall-clock Date
 * into a pinned formatter) so an Amman-evening appointment renders the
 * correct day even when the process runs under TZ=UTC.
 */
export function clinicWeekdayName(
  instant: Date,
  locale: 'ar' | 'en',
  timeZone: string = CLINIC_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-GB', {
    weekday: 'long',
    timeZone,
  }).format(instant);
}

export function clinicHm(instant: Date, timeZone: string = CLINIC_TIME_ZONE): string {
  const p = clinicWallParts(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * The UTC instant at which the clinic wall-clock reads the given fields
 * (month 1-based; hour/minute/second default 0). The inverse of
 * `clinicWallParts`. Resolved via Intl (two-pass around DST transitions) —
 * no fixed-offset arithmetic.
 */
export function clinicWallToInstant(
  wall: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timeZone: string = CLINIC_TIME_ZONE,
): Date {
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour ?? 0,
    wall.minute ?? 0,
    wall.second ?? 0,
  );
  // First guess assumes the offset at the "as if UTC" moment, then re-resolve
  // at the guessed instant so a DST boundary between the two is honoured.
  const guess = asIfUtc - tzOffsetMs(new Date(asIfUtc), timeZone);
  return new Date(asIfUtc - tzOffsetMs(new Date(guess), timeZone));
}

/**
 * Parse an `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm") as
 * CLINIC wall-clock and return the UTC instant. Returns null on malformed
 * input. Use this instead of `new Date(value)`, which silently applies the
 * machine's timezone (browser or — worse — a UTC server).
 */
export function parseClinicDateTimeLocal(
  value: string,
  timeZone: string = CLINIC_TIME_ZONE,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!m) return null;
  return clinicWallToInstant(
    {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
      hour: Number(m[4]),
      minute: Number(m[5]),
    },
    timeZone,
  );
}

/** Render an instant as a datetime-local input value in clinic wall time. */
export function formatClinicDateTimeLocal(
  instant: Date,
  timeZone: string = CLINIC_TIME_ZONE,
): string {
  return `${clinicDateKey(instant, timeZone)}T${clinicHm(instant, timeZone)}`;
}

/**
 * Re-express an instant as a Date whose BROWSER-LOCAL fields equal the clinic
 * wall-clock — the representation react-big-calendar needs to position events
 * on the clinic's grid regardless of the viewing machine's timezone. On a
 * machine already set to the clinic zone this is the identity.
 *
 * Only use the result for grid positioning / local-field reads; it is NOT the
 * real instant. Convert back with `fromClinicWall` before persisting or
 * conflict-checking. (If the browser zone has a DST gap at exactly the target
 * wall time the platform shifts by an hour — cosmetic, and impossible in
 * fixed-offset Jordan.)
 */
export function toClinicWall(instant: Date, timeZone: string = CLINIC_TIME_ZONE): Date {
  const p = clinicWallParts(instant, timeZone);
  return new Date(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    // Offsets are whole minutes in every modern zone, so seconds/ms carry over.
    p.second,
    instant.getUTCMilliseconds(),
  );
}

/** Inverse of `toClinicWall`: browser-local fields read as clinic wall-clock. */
export function fromClinicWall(wall: Date, timeZone: string = CLINIC_TIME_ZONE): Date {
  const instant = clinicWallToInstant(
    {
      year: wall.getFullYear(),
      month: wall.getMonth() + 1,
      day: wall.getDate(),
      hour: wall.getHours(),
      minute: wall.getMinutes(),
      second: wall.getSeconds(),
    },
    timeZone,
  );
  return new Date(instant.getTime() + wall.getMilliseconds());
}
