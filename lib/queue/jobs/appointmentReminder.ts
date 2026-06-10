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
