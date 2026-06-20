/**
 * Overdue-session auto-complete worker (Fix Prompt 2 — Receptionist #21).
 *
 * Registered as a BullMQ repeat job firing every 15 minutes. Each tick closes
 * any IN_PROGRESS session left open past `appointment_end + grace`, attributing
 * the change to the reserved `system` audit actor. Runs regardless of whether
 * anyone has a page open.
 *
 * The `tz: 'Asia/Amman'` on the repeat rule only controls the cron CADENCE; the
 * overdue comparison itself is instant-vs-instant and tz-independent (see
 * lib/appointments/session-timing.ts).
 *
 * Registering the recurring job is idempotent via the deterministic jobId, so
 * re-runs / hot reload are no-ops.
 */

import { Worker } from 'bullmq';

import { autoCompleteOverdueSessions } from '@/lib/appointments/autoComplete';
import { queueRedis } from '@/lib/queue/client';
import { SESSION_MAINTENANCE_QUEUE, sessionMaintenanceQueue } from '@/lib/queue/queues';

const JOB_NAME = 'sessionAutoComplete';
const JOB_ID = 'session-auto-complete';
const CRON_PATTERN = '*/15 * * * *'; // every 15 minutes.

export async function ensureSessionAutoCompleteScheduled(): Promise<void> {
  await sessionMaintenanceQueue.add(
    JOB_NAME,
    {},
    {
      repeat: { pattern: CRON_PATTERN, tz: 'Asia/Amman' },
      jobId: JOB_ID,
    },
  );
}

export function startSessionAutoCompleteWorker(): Worker {
  const worker = new Worker(
    SESSION_MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name !== JOB_NAME) return;
      const r = await autoCompleteOverdueSessions();
      console.warn(`[session-auto-complete] scanned=${r.scanned} completed=${r.completed}`);
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    if (job?.name !== JOB_NAME) return;
    console.error(`[session-auto-complete] failed: ${err.message}`);
  });

  return worker;
}
