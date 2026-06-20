import type { LocalizedError } from '@/lib/db';

/**
 * Session-lifecycle timing gates (Fix Prompt 2).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ IMPORTANT — these are ABSOLUTE-INSTANT comparisons and are intentionally  │
 * │ timezone-INDEPENDENT. `startsAt`, `endsAt`, and `now` are all absolute     │
 * │ instants (UTC under the hood); "± N minutes" is duration arithmetic on    │
 * │ instants, so converting either side to clinic-local (Asia/Amman) wall-    │
 * │ clock would yield the IDENTICAL boolean and is pointless ceremony.        │
 * │                                                                           │
 * │ This is categorically DIFFERENT from the working-hours check              │
 * │ (lib/appointments/working-hours.ts), which compares an instant against a  │
 * │ wall-clock STRING ("09:00") and therefore genuinely needs Amman           │
 * │ conversion. Do NOT route the comparisons below through tzOffsetMs — that   │
 * │ would re-introduce needless tz code, not fix anything.                    │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Pure + dependency-free so the gate (server action) and the auto-complete
 * worker share one implementation and unit-test fast.
 */

/** The earliest instant a session may be started: `start − graceMinutes`. */
export function earliestSessionStart(startsAt: Date, graceMinutes: number): Date {
  return new Date(startsAt.getTime() - graceMinutes * 60_000);
}

/** Whether a session may be started at `now` (within the start-grace window). */
export function canStartSessionAt(now: Date, startsAt: Date, graceMinutes: number): boolean {
  // instant vs instant — tz-independent (see file header).
  return now.getTime() >= earliestSessionStart(startsAt, graceMinutes).getTime();
}

/**
 * Whether a proposed appointment start is in the past (Fix 6C item 1).
 * Strictly-before-now is past; start == now or future is allowed. Instant vs
 * instant — tz-independent (see file header); do NOT convert to clinic-local.
 */
export function isStartInPast(startsAt: Date, now: Date = new Date()): boolean {
  return startsAt.getTime() < now.getTime();
}

/** The session's scheduled end instant. */
export function sessionEndsAt(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60_000);
}

/**
 * Whether an open session is overdue for auto-completion: now is at/after
 * `end + graceMinutes`. The grace lets a slightly-overrunning real session
 * finish before the worker force-closes it.
 */
export function isSessionOverdue(
  now: Date,
  startsAt: Date,
  durationMinutes: number,
  graceMinutes: number,
): boolean {
  const threshold = sessionEndsAt(startsAt, durationMinutes).getTime() + graceMinutes * 60_000;
  // instant vs instant — tz-independent (see file header).
  return now.getTime() >= threshold;
}

/**
 * Localized error for an attempt to start a session before its grace window.
 * The earliest-allowed time is formatted in the clinic timezone for display
 * (human-facing wall-clock — NOT part of the gate comparison above).
 */
export function sessionStartTooEarly(earliest: Date, timeZone = 'Asia/Amman'): LocalizedError {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(earliest);
  return {
    code: 'SESSION_START_TOO_EARLY',
    message_en: `This session can only be started from ${hhmm} onward.`,
    message_ar: `لا يمكن بدء هذه الجلسة إلا اعتبارًا من الساعة ${hhmm}.`,
    details: { earliest: earliest.toISOString() },
  };
}
