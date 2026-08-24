import type { WaDispatchStatus, WaDispatchType } from '@prisma/client';

/**
 * P51 §4.5 — the staleness rule, pure: a held message must not outlive its
 * moment. Evaluated on outbox render (visual label; nothing written) and
 * at Send time (stale rows are marked STALE + audited and never send).
 *
 *   REMINDER               stale once the appointment has STARTED (>= start
 *                          — a reminder at/after start is meaningless).
 *   ARRIVAL                stale once the appointment has ENDED (start +
 *                          duration) — a same-visit send is still useful.
 *   BOOKING_CONFIRMATION   stale once the appointment started, or when the
 *                          appointment is CANCELLED (extends the P48
 *                          cancel-before-send silence idea).
 *   RESCHEDULE/CANCELLATION never stale by TIME — a patient should learn of
 *                          a cancellation even late; only the P48 supersede
 *                          logic replaces them.
 *   HOME_PROGRAM           never stale by time (not tied to a moment); the
 *                          admin can Exclude one manually.
 */
export interface StaleCheckInput {
  type: WaDispatchType;
  status: WaDispatchStatus;
  appointmentStartsAt: Date | null;
  appointmentDurationMinutes: number | null;
  appointmentStatus: string | null;
}

export function isStale(input: StaleCheckInput, now: Date): boolean {
  // Only rows still waiting can go stale; everything else already resolved.
  if (input.status !== 'PENDING') return false;
  const start = input.appointmentStartsAt?.getTime();

  switch (input.type) {
    case 'REMINDER':
      return start !== undefined && now.getTime() >= start;
    case 'ARRIVAL': {
      if (start === undefined) return false;
      const end = start + (input.appointmentDurationMinutes ?? 0) * 60_000;
      return now.getTime() > end;
    }
    case 'BOOKING_CONFIRMATION':
      if (input.appointmentStatus === 'CANCELLED') return true;
      return start !== undefined && now.getTime() >= start;
    case 'RESCHEDULE':
    case 'CANCELLATION':
    case 'HOME_PROGRAM':
      return false;
  }
}
