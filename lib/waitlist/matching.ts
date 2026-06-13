import type { WaitlistStatus } from '@prisma/client';

/**
 * Booking-waitlist matcher (Prompt 19 §3.2) — the single source of truth for
 * "does this freed slot match a waiting entry?". Kept PURE (no DB, no clock of
 * its own — `now` is injected) so it is exhaustively unit-tested.
 *
 * A freed slot matches a `WAITING` entry when:
 *   1. the entry is still WAITING,
 *   2. its window has not already passed (`windowEnd > now` — an expired
 *      window can never be fulfilled, so it never notifies),
 *   3. the freed slot's start falls inside `[windowStart, windowEnd)`,
 *   4. the entry has no therapist preference, OR it prefers this therapist.
 *
 * Results are ordered oldest-first (FIFO) so the notification + placement UI
 * can offer the longest-waiting patient first (§3.5).
 */

export interface FreedSlot {
  /** UTC start of the slot that just freed up. */
  startsAt: Date;
  /** Therapist whose slot freed. */
  therapistId: string;
}

export interface WaitlistCandidate {
  id: string;
  windowStart: Date;
  windowEnd: Date;
  preferredTherapistId: string | null;
  status: WaitlistStatus;
  createdAt: Date;
}

export function matchWaitlistEntries<T extends WaitlistCandidate>(
  slot: FreedSlot,
  candidates: T[],
  now: Date,
): T[] {
  const slotMs = slot.startsAt.getTime();
  const nowMs = now.getTime();
  return candidates
    .filter((c) => c.status === 'WAITING')
    .filter((c) => c.windowEnd.getTime() > nowMs)
    .filter((c) => slotMs >= c.windowStart.getTime() && slotMs < c.windowEnd.getTime())
    .filter((c) => c.preferredTherapistId === null || c.preferredTherapistId === slot.therapistId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Lazy-expiry predicate (Prompt 19 §3 lifecycle). An entry is expired once its
 * acceptable window has fully passed — at that point no slot can ever match it.
 * Keyed on the same `windowEnd > now` boundary the matcher uses, so the two can
 * never disagree (an expired entry is exactly one the matcher would skip).
 */
export function isExpired(entry: { status: WaitlistStatus; windowEnd: Date }, now: Date): boolean {
  return entry.status === 'WAITING' && entry.windowEnd.getTime() <= now.getTime();
}
