/**
 * P50 (series 45+) item 1.3 — the outbox "urgent" marker.
 *
 * Purely VISUAL: an outbox entry whose appointment starts within the next
 * 24h is flagged so the admin can spot what to send first. It never sends
 * anything and never changes scheduling — MANUAL mode is absolute silence
 * (the <24h safety exception was removed, owner order 19 Aug 2026); this
 * badge is the information that exception used to act on.
 */

export const URGENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True when the appointment is still ahead and starts within 24h of `now`. */
export function isUrgentDispatch(
  appointmentStartsAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!appointmentStartsAt) return false;
  const lead = appointmentStartsAt.getTime() - now.getTime();
  return lead > 0 && lead < URGENT_WINDOW_MS;
}
