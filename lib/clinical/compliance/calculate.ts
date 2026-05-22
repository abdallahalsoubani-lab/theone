// Intentionally NOT `server-only` — imported by the compliance worker
// chain (pure Node via tsx), which would crash at import time without a
// Next.js bundler to swap the marker.

import { db } from '@/lib/db';

/**
 * Patient compliance — fraction of scheduled home-program occurrences
 * the patient has actually completed across a window (Prompt 10 §4.8).
 *
 * "Scheduled occurrences" = for each active HomeProgramItem, count the
 * number of days in the window where the weekday is in `daysOfWeek`.
 *
 * `overdue` = scheduled occurrences in the last 2 days that have no
 * matching HomeProgramCompletion row. Used by the Therapist dashboard
 * to flag patients who need a nudge.
 *
 * Edge cases:
 *   - No active items → rate=null (no signal). UI renders "No program".
 *   - All scheduled, all completed → rate=1.
 *   - Items added mid-window: they contribute only from their createdAt
 *     date forward, so a freshly assigned program doesn't show 0%
 *     overnight.
 */

export interface ComplianceResult {
  rate: number | null;
  expected: number;
  completed: number;
  overdue: number;
}

export interface ComplianceArgs {
  patientId: string;
  windowDays: 7 | 30;
  /** Override for tests — defaults to now. */
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function calculateCompliance(args: ComplianceArgs): Promise<ComplianceResult> {
  const now = args.now ?? new Date();
  const windowStart = new Date(now);
  windowStart.setUTCHours(0, 0, 0, 0);
  windowStart.setUTCDate(windowStart.getUTCDate() - args.windowDays + 1);
  const overdueStart = new Date(now);
  overdueStart.setUTCHours(0, 0, 0, 0);
  overdueStart.setUTCDate(overdueStart.getUTCDate() - 2);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  const items = await db.homeProgramItem.findMany({
    where: { patientId: args.patientId, active: true },
    select: {
      id: true,
      daysOfWeek: true,
      createdAt: true,
    },
  });

  if (items.length === 0) {
    return { rate: null, expected: 0, completed: 0, overdue: 0 };
  }

  // Per-item: enumerate scheduled occurrences in [windowStart, today].
  let expected = 0;
  let overdueExpected = 0;
  const expectedKeys = new Map<string, Set<string>>(); // itemId → set of YYYY-MM-DD
  for (const item of items) {
    const itemStart = new Date(
      Math.max(windowStart.getTime(), new Date(item.createdAt).setUTCHours(0, 0, 0, 0)),
    );
    const set = new Set<string>();
    for (let d = itemStart.getTime(); d <= today.getTime(); d += DAY_MS) {
      const date = new Date(d);
      const dow = date.getUTCDay();
      if (item.daysOfWeek.includes(dow)) {
        expected += 1;
        set.add(date.toISOString().slice(0, 10));
        if (d >= overdueStart.getTime()) overdueExpected += 1;
      }
    }
    expectedKeys.set(item.id, set);
  }

  const completions = await db.homeProgramCompletion.findMany({
    where: {
      item: { patientId: args.patientId, active: true },
      scheduledDate: { gte: windowStart, lte: today },
    },
    select: { itemId: true, scheduledDate: true },
  });

  let completed = 0;
  let overdueCompleted = 0;
  for (const c of completions) {
    const key = c.scheduledDate.toISOString().slice(0, 10);
    const set = expectedKeys.get(c.itemId);
    if (set && set.has(key)) {
      completed += 1;
      if (c.scheduledDate.getTime() >= overdueStart.getTime()) overdueCompleted += 1;
    }
  }

  const rate = expected > 0 ? completed / expected : null;
  return {
    rate,
    expected,
    completed,
    overdue: Math.max(0, overdueExpected - overdueCompleted),
  };
}

/**
 * Streak: consecutive scheduled days where the patient logged at least
 * one completion. Walks backward from today, stopping at the first
 * scheduled-but-uncompleted day.
 */
export async function calculateStreak(args: { patientId: string; now?: Date }): Promise<number> {
  const now = args.now ?? new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  const items = await db.homeProgramItem.findMany({
    where: { patientId: args.patientId, active: true },
    select: { daysOfWeek: true },
  });
  if (items.length === 0) return 0;

  // Pull last 60 days of completions — enough headroom for any plausible streak.
  const lookback = new Date(today);
  lookback.setUTCDate(lookback.getUTCDate() - 60);
  const completions = await db.homeProgramCompletion.findMany({
    where: {
      item: { patientId: args.patientId, active: true },
      scheduledDate: { gte: lookback, lte: today },
    },
    select: { scheduledDate: true },
  });
  const completedDays = new Set(completions.map((c) => c.scheduledDate.toISOString().slice(0, 10)));

  // Aggregate the union of scheduled days across all items.
  const scheduledOn = (d: Date) => {
    const dow = d.getUTCDay();
    return items.some((i) => i.daysOfWeek.includes(dow));
  };

  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - i);
    if (!scheduledOn(day)) continue;
    const key = day.toISOString().slice(0, 10);
    if (completedDays.has(key)) streak += 1;
    else break;
  }
  return streak;
}
