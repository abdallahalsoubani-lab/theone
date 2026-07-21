/**
 * Session auto-complete worker (July change request #4).
 *
 * Consumes the per-appointment delayed jobs enqueued by
 * `enqueueAutoCompleteSession` at `startsAt + durationMinutes` (zero grace).
 * When a job fires it re-reads the appointment and, only if it is still
 * IN_PROGRESS, transitions it to COMPLETED via the audited `autoCompleteSession`
 * service (SYSTEM actor). Everything else is a clean no-op:
 *   - SCHEDULED / CONFIRMED → the patient never checked in; not our job to
 *     complete a session that didn't happen.
 *   - COMPLETED / CANCELLED / NO_SHOW → already terminal.
 *
 * Subscribes to SESSION_MAINTENANCE_QUEUE (its own queue so the job is never
 * consumed by another worker — see the worker-race note in queues.ts).
 */
import { Worker } from 'bullmq';

import { autoCompleteSession } from '@/lib/appointments/auto-complete';
import { db } from '@/lib/db';
import { queueRedis } from '@/lib/queue/client';
import type { AutoCompleteSessionJob } from '@/lib/queue/jobs/autoCompleteSession';
import { SESSION_MAINTENANCE_QUEUE } from '@/lib/queue/queues';

export function startAutoCompleteWorker(): Worker {
  const worker = new Worker<AutoCompleteSessionJob>(
    SESSION_MAINTENANCE_QUEUE,
    async (job) => {
      const { appointmentId } = job.data;
      const appt = await db.appointment.findUnique({
        where: { id: appointmentId },
        select: { status: true },
      });
      if (!appt) {
        console.warn(`[autoComplete] appointment ${appointmentId} no longer exists — skipping`);
        return;
      }
      if (appt.status !== 'IN_PROGRESS') {
        // Never checked in, already completed, cancelled, or a no-show.
        return;
      }
      const { completed } = await autoCompleteSession(appointmentId);
      console.warn(
        `[autoComplete] ${appointmentId} → ${completed ? 'COMPLETED' : 'no-op (status changed under us)'}`,
      );
    },
    { connection: queueRedis },
  );
  return worker;
}
