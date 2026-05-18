import { reminderQueue } from '../queues';

/**
 * Home-exercise reminder cron computation + BullMQ registration
 * (Prompt 10 §4.7).
 *
 * Each HomeProgramItem registers a BullMQ repeating job. The cron
 * pattern is derived from `scheduledTime` and `daysOfWeek`, with the
 * patient's local-clinic-time offset applied (default 30 minutes
 * ahead of the scheduled exercise time via HOME_REMINDER_OFFSET_MINUTES).
 *
 * Timezone: Asia/Amman. The cron pattern itself encodes local-clinic
 * time; BullMQ's repeat options carry `tz` so the worker fires at
 * 18:00 local rather than 18:00 UTC.
 *
 * Previous-day rollover edge case: subtracting the reminder offset
 * can push the trigger to the previous calendar day (e.g., 00:15 -
 * 30min = 23:45 the previous day). The day-of-week selector shifts
 * accordingly so a Tuesday 00:15 exercise actually fires Monday
 * 23:45. computeReminderCron handles this; tests cover the corner.
 */

export interface ReminderCronArgs {
  /** "HH:MM" — the patient-facing exercise time. */
  scheduledTime: string;
  /** 0=Sunday … 6=Saturday. */
  daysOfWeek: ReadonlyArray<number>;
  /** Minutes ahead of scheduledTime the reminder fires. */
  offsetMinutes: number;
}

export interface ReminderCronResult {
  /** "MM HH * * D1,D2,…" — BullMQ-compatible cron pattern. */
  pattern: string;
  /** Days that actually fire after the offset shift. */
  shiftedDays: number[];
  /** Minutes (0-59) the reminder fires at. */
  minute: number;
  /** Hour (0-23) the reminder fires at. */
  hour: number;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * Compute the cron pattern + shifted day-of-week set for a reminder.
 * Pure — no DB / Redis access — so the tests can hammer it without
 * a fixture.
 */
export function computeReminderCron(args: ReminderCronArgs): ReminderCronResult {
  const [hourStr, minuteStr] = args.scheduledTime.split(':');
  const baseMinute = Number.parseInt(minuteStr ?? '0', 10);
  const baseHour = Number.parseInt(hourStr ?? '0', 10);
  // Total minutes from start of day for the *exercise* time.
  const baseTotal = baseHour * 60 + baseMinute;
  const adjustedTotal = baseTotal - args.offsetMinutes;
  // Day shift in days: negative when rollover backwards, positive if
  // someone passes a negative offset (not used today, but the math
  // generalizes).
  const dayShift = Math.floor(adjustedTotal / MINUTES_PER_DAY);
  // Modulo of the adjusted total, wrapped to [0, MINUTES_PER_DAY).
  const wrapped = ((adjustedTotal % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;

  // Apply the day shift to each selected day, keeping 0-6 range. A
  // shift of -1 means each Tue (2) actually fires Monday (1), and a
  // Sunday (0) shift becomes Saturday (6).
  const shiftedDays = Array.from(
    new Set(args.daysOfWeek.map((d) => (((d + dayShift) % 7) + 7) % 7)),
  ).sort((a, b) => a - b);

  const pattern = `${minute} ${hour} * * ${shiftedDays.join(',')}`;
  return { pattern, shiftedDays, minute, hour };
}

export interface HomeReminderJobData {
  itemId: string;
}

/**
 * Register the recurring reminder job for an item. Returns the repeat
 * job key so the row can persist it for later removal. The jobId is
 * derived from the item id — BullMQ deduplicates so re-running
 * `add()` with the same id is safe.
 */
export async function registerHomeReminderJob(args: {
  itemId: string;
  scheduledTime: string;
  daysOfWeek: ReadonlyArray<number>;
  offsetMinutes: number;
  timezone?: string;
}): Promise<string | null> {
  const cron = computeReminderCron({
    scheduledTime: args.scheduledTime,
    daysOfWeek: args.daysOfWeek,
    offsetMinutes: args.offsetMinutes,
  });
  const job = await reminderQueue.add(
    'homeExerciseReminder',
    { itemId: args.itemId } satisfies HomeReminderJobData,
    {
      repeat: { pattern: cron.pattern, tz: args.timezone ?? 'Asia/Amman' },
      jobId: `home-reminder:${args.itemId}`,
    },
  );
  // The repeat-job key comes back on the parent job's opts. Different
  // BullMQ versions expose it slightly differently; coalesce.
  const opts = job.opts as { repeatJobKey?: string; repeat?: { key?: string } };
  return opts.repeatJobKey ?? opts.repeat?.key ?? `home-reminder:${args.itemId}`;
}

/**
 * Remove the recurring reminder job by its key. Silently no-ops if the
 * key is null or already removed — both are safe in the
 * update / delete service paths.
 */
export async function removeHomeReminderJob(jobKey: string | null): Promise<void> {
  if (!jobKey) return;
  try {
    await reminderQueue.removeRepeatableByKey(jobKey);
  } catch (err) {
    console.warn('[home-reminder] removeRepeatableByKey failed', err);
  }
}
