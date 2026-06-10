/**
 * Appointment-reminder fire-time math (Prompt 17).
 *
 * One reminder, `offsetMinutes` before the appointment (default 24h), clamped
 * to the clinic-local [windowStart, windowEnd] window so a message is never
 * sent outside working hours. Pure + timezone-aware (Asia/Amman) so it is
 * fully unit-tested independent of BullMQ / Prisma.
 *
 * Note: the local↔UTC conversion reads the zone offset at the instant in
 * question. Jordan is a fixed UTC+3 (no DST since 2022), so a single offset
 * holds across the day; the math would only be approximate within the hour of
 * a DST transition, which Asia/Amman no longer has.
 */

export interface ReminderConfig {
  offsetMinutes: number;
  windowStartMinutes: number;
  windowEndMinutes: number;
  timeZone: string;
}

const DAY_MS = 86_400_000;

/** Parse "HH:MM" into minutes past midnight. */
export function parseHhMm(value: string): number {
  const [h, m] = value.split(':').map((n) => parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Zone offset (localWall − UTC) in ms at the given instant. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUTC = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUTC - date.getTime();
}

/** Local wall-clock minutes past midnight for an instant. */
function localMinutesOfDay(instant: Date, timeZone: string): number {
  const wall = new Date(instant.getTime() + tzOffsetMs(instant, timeZone));
  return wall.getUTCHours() * 60 + wall.getUTCMinutes();
}

/** UTC instant for "the local day containing `instant`, at `minutes` past local midnight". */
function localTimeOnDayOf(instant: Date, minutes: number, timeZone: string): Date {
  const off = tzOffsetMs(instant, timeZone);
  const wall = new Date(instant.getTime() + off);
  const wallMidnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  return new Date(wallMidnight + minutes * 60_000 - off);
}

/** The next time the window opens at/after `now` (today's open, or tomorrow's). */
function nextWindowOpening(now: Date, windowStartMinutes: number, timeZone: string): Date {
  const nowMin = localMinutesOfDay(now, timeZone);
  if (nowMin < windowStartMinutes) return localTimeOnDayOf(now, windowStartMinutes, timeZone);
  return localTimeOnDayOf(new Date(now.getTime() + DAY_MS), windowStartMinutes, timeZone);
}

/**
 * Compute the absolute fire time (UTC) for an appointment reminder, or `null`
 * when no reminder can be sent before the appointment starts (skip + log).
 */
export function computeReminderFireAt(args: {
  startsAt: Date;
  now: Date;
  config: ReminderConfig;
}): Date | null {
  const { startsAt, now, config } = args;
  const { offsetMinutes, windowStartMinutes, windowEndMinutes, timeZone } = config;

  // 1. Ideal base time, then clamp to the window on the base's local day.
  const base = new Date(startsAt.getTime() - offsetMinutes * 60_000);
  const baseMin = localMinutesOfDay(base, timeZone);
  let fireAt: Date;
  if (baseMin < windowStartMinutes) {
    fireAt = localTimeOnDayOf(base, windowStartMinutes, timeZone);
  } else if (baseMin > windowEndMinutes) {
    fireAt = localTimeOnDayOf(base, windowEndMinutes, timeZone);
  } else {
    fireAt = base;
  }

  // 2. Late booking / past fire time → send now if inside the window, else at
  //    the next window opening.
  if (fireAt.getTime() <= now.getTime()) {
    const nowMin = localMinutesOfDay(now, timeZone);
    fireAt =
      nowMin >= windowStartMinutes && nowMin <= windowEndMinutes
        ? now
        : nextWindowOpening(now, windowStartMinutes, timeZone);
  }

  // 3. Never after the appointment has started — if it can't fit, skip.
  if (fireAt.getTime() >= startsAt.getTime()) return null;
  return fireAt;
}
