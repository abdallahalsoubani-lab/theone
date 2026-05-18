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
  return `appointment-reminder:${appointmentId}`;
}

export interface AppointmentReminderJob {
  appointmentId: string;
}

/**
 * Enqueue a delayed reminder. Returns null when the fire time is already in
 * the past — caller should treat that as "no reminder scheduled" rather than
 * an error (typical when scheduling an imminent appointment).
 */
export async function enqueueAppointmentReminder(args: {
  appointmentId: string;
  startsAt: Date;
  reminderOffsetMinutes: number;
}): Promise<string | null> {
  const fireAt = args.startsAt.getTime() - args.reminderOffsetMinutes * 60_000;
  const delay = fireAt - Date.now();
  if (delay <= 0) return null;

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
