import { computeReminderFireAt, type ReminderConfig } from '@/lib/appointments/reminderWindow';

import { reminderQueue } from '../queues';

/**
 * Deterministic job id for the appointment reminder.
 *
 * Re-enqueueing with the same id is idempotent — BullMQ rejects duplicates
 * and we explicitly remove the existing job first when rescheduling. The
 * stable id also lets `cancelAppointmentReminder(appointmentId)` work
 * without storing the BullMQ id alongside the appointment.
 */
export function reminderJobId(appointmentId: string): string {
  // BullMQ 5.x rejects custom job IDs containing `:` (reserved for internal
  // key namespacing). Use a dash separator to keep the deterministic-id
  // contract while staying compatible.
  return `appointment-reminder-${appointmentId}`;
}

export interface AppointmentReminderJob {
  appointmentId: string;
  /** P53/P48 — deferred lifecycle messages ride the SAME queue + worker as
   *  reminders (no parallel mechanism). Absent/'reminder' = the P17
   *  reminder; 'arrival' = a P51 outbox-sent arrival confirmation; the
   *  rest are dispatch-layer sends (P48). */
  kind?: 'reminder' | 'confirmation' | 'reschedule' | 'cancellation' | 'arrival';
  /** P51 — true when an admin pressed Send in the outbox: a human action,
   *  so the silent-mode gate does not re-hold it at fire time. */
  adminSend?: boolean;
}

// ─── P53: deferred, coalescing lifecycle messages ──────────────────────────

export type LifecycleKind = 'confirmation' | 'reschedule' | 'cancellation';

export function lifecycleJobId(kind: LifecycleKind, appointmentId: string): string {
  if (kind === 'confirmation') return `confirm-${appointmentId}`;
  if (kind === 'reschedule') return `resched-${appointmentId}`;
  return `cancelmsg-${appointmentId}`; // P48 — cancellation joined the family
}

/** Send at start−15min at the latest — never after start. */
const LIFECYCLE_CLAMP_MS = 15 * 60 * 1000;

/**
 * The near-appointment clamp (§1.4, pure for tests): fire at the EARLIER of
 * (now + delay) and (startsAt − 15min), floored at "now" (immediate-ish for
 * near appointments). Null = the appointment already started → skip + log.
 */
export function computeLifecycleDelayMs(args: {
  now: Date;
  startsAt: Date;
  delayMinutes: number;
  /** P48 — a CANCELLATION message is ABOUT a slot, not ahead of it: the
   *  "send before start" clamp and the past-start skip don't apply. */
  kind?: LifecycleKind;
}): number | null {
  if (args.kind === 'cancellation') {
    return Math.max(0, args.delayMinutes * 60 * 1000);
  }
  if (args.startsAt.getTime() <= args.now.getTime()) return null;
  const byDelay = args.delayMinutes * 60 * 1000;
  const byClamp = args.startsAt.getTime() - LIFECYCLE_CLAMP_MS - args.now.getTime();
  return Math.max(0, Math.min(byDelay, byClamp));
}

/**
 * Schedule (or REPLACE — the coalescing) the deferred lifecycle message for
 * an appointment. Removes any pending job of EITHER kind first, so an edit
 * during the wait swaps the pending message and restarts the timer (§1.3).
 * Returns the job id, or null when the appointment is past-start (skip+log,
 * mirroring the P17 late-booking rule).
 */
export async function scheduleLifecycleMessage(args: {
  appointmentId: string;
  startsAt: Date;
  kind: LifecycleKind;
  delayMinutes: number;
  /** P51 — set by the outbox Send button; rides into the job so the
   *  worker's silent-mode gate lets the human-initiated send through. */
  adminSend?: boolean;
}): Promise<string | null> {
  await cancelLifecycleMessages(args.appointmentId);
  const delay = computeLifecycleDelayMs({
    now: new Date(),
    startsAt: args.startsAt,
    delayMinutes: args.delayMinutes,
    kind: args.kind,
  });
  if (delay === null) {
    console.warn(
      `[lifecycle] appointment ${args.appointmentId} already started — ${args.kind} message skipped`,
    );
    return null;
  }
  const jobId = lifecycleJobId(args.kind, args.appointmentId);
  const job = await reminderQueue.add(
    'appointment',
    {
      appointmentId: args.appointmentId,
      kind: args.kind,
      ...(args.adminSend ? { adminSend: true } : {}),
    } satisfies AppointmentReminderJob,
    { delay, jobId },
  );
  return job.id ?? null;
}

/**
 * Remove any pending deferred confirmation/reschedule for an appointment
 * (cancel path — sits beside cancelAppointmentReminder, same machinery).
 * Reports whether a pending CONFIRMATION existed, so the series-cancel path
 * can retarget the one series confirmation to the next occurrence (§1-2.3).
 */
export async function cancelLifecycleMessages(
  appointmentId: string,
): Promise<{ confirmWasPending: boolean }> {
  const confirmId = lifecycleJobId('confirmation', appointmentId);
  const confirmWasPending = Boolean(
    await reminderQueue
      .getJob(confirmId)
      .then((j) => j && (j.delay ?? 0) >= 0)
      .catch(() => false),
  );
  await reminderQueue.remove(confirmId).catch(() => undefined);
  await reminderQueue.remove(lifecycleJobId('reschedule', appointmentId)).catch(() => undefined);
  await reminderQueue.remove(lifecycleJobId('cancellation', appointmentId)).catch(() => undefined);
  return { confirmWasPending };
}

/**
 * Enqueue the single 24h-window reminder (Prompt 17). The fire time is the
 * appointment start minus the configured offset, clamped to the clinic's
 * [windowStart, windowEnd] local window (and shifted to the next opening for
 * late bookings). Returns null when no reminder can fit before the appointment
 * starts — caller treats that as "no reminder scheduled" (and may log a skip).
 */
export async function enqueueAppointmentReminder(args: {
  appointmentId: string;
  startsAt: Date;
  config: ReminderConfig;
}): Promise<string | null> {
  const fireAt = computeReminderFireAt({
    startsAt: args.startsAt,
    now: new Date(),
    config: args.config,
  });
  if (!fireAt) return null;
  // fireAt may be ~now for an in-window late booking → delay 0 fires immediately.
  const delay = Math.max(0, fireAt.getTime() - Date.now());

  const jobId = reminderJobId(args.appointmentId);
  // Idempotency: remove the existing job before re-adding so the delay window
  // reflects the latest schedule.
  await reminderQueue.remove(jobId).catch(() => undefined);

  const job = await reminderQueue.add(
    'appointment',
    { appointmentId: args.appointmentId } satisfies AppointmentReminderJob,
    { delay, jobId },
  );
  return job.id ?? null;
}

/**
 * Remove a pending reminder. Called on cancellation and as the first step of
 * a reschedule. Silently no-ops if the job has already fired or was never
 * enqueued.
 */
export async function cancelAppointmentReminder(appointmentId: string): Promise<void> {
  await reminderQueue.remove(reminderJobId(appointmentId)).catch(() => undefined);
}
