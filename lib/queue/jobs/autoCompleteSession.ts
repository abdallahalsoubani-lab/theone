import { sessionMaintenanceQueue } from '../queues';

/**
 * Deterministic job id for a session's auto-complete (July change request #4).
 * Stable id → `cancelAutoCompleteSession(appointmentId)` works without storing
 * the BullMQ id, and re-enqueue is idempotent. Dash-separated (BullMQ 5.x
 * rejects `:` in custom ids), mirroring `reminderJobId`.
 */
export function autoCompleteJobId(appointmentId: string): string {
  return `session-autocomplete-${appointmentId}`;
}

export interface AutoCompleteSessionJob {
  appointmentId: string;
}

/**
 * Schedule the auto-complete of a session at its scheduled end
 * (`startsAt + durationMinutes`), ZERO grace (July change request #4 — the
 * clinic wants sessions to finish on their own). Enqueued for every
 * appointment on create/reschedule; the worker only completes it if it is
 * actually IN_PROGRESS when the job fires (idempotent no-op otherwise — a
 * session that never started is never force-completed).
 *
 * Re-enqueue is idempotent (remove-before-add), mirroring
 * `enqueueAppointmentReminder`.
 */
export async function enqueueAutoCompleteSession(args: {
  appointmentId: string;
  startsAt: Date;
  durationMinutes: number;
}): Promise<string | null> {
  const fireAt = args.startsAt.getTime() + args.durationMinutes * 60_000;
  // A booking created after its own end time (edge case) → delay 0, fires now.
  const delay = Math.max(0, fireAt - Date.now());

  const jobId = autoCompleteJobId(args.appointmentId);
  await sessionMaintenanceQueue.remove(jobId).catch(() => undefined);

  const job = await sessionMaintenanceQueue.add(
    'autoCompleteSession',
    { appointmentId: args.appointmentId } satisfies AutoCompleteSessionJob,
    { delay, jobId },
  );
  return job.id ?? null;
}

/**
 * Remove a pending auto-complete job. Called on cancellation and as the first
 * step of a reschedule (before re-enqueueing the new time). No-ops if the job
 * already fired or was never enqueued.
 */
export async function cancelAutoCompleteSession(appointmentId: string): Promise<void> {
  await sessionMaintenanceQueue.remove(autoCompleteJobId(appointmentId)).catch(() => undefined);
}
