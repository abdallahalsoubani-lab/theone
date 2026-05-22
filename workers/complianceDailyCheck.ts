/**
 * Daily low-compliance scan (Prompt 10 §4.8.3).
 *
 * Registered as a BullMQ repeat job firing at 18:00 Asia/Amman every
 * day. Each tick walks the patient roster and emits LOW_COMPLIANCE
 * notifications to the assigned Therapist for any patient whose
 * 7-day rate sits below the threshold (default 50%), with a 3-day
 * cooldown per (therapist, patient) pair to avoid spam.
 *
 * Hot reload / dev: registering the recurring job is idempotent via
 * the deterministic jobId, so re-runs are no-ops.
 */

import { Worker } from 'bullmq';

import { runLowComplianceCheck } from '@/lib/clinical/compliance/checkLowCompliance';
import { queueRedis } from '@/lib/queue/client';
import { COMPLIANCE_QUEUE, complianceQueue } from '@/lib/queue/queues';

const JOB_NAME = 'complianceDailyCheck';
const JOB_ID = 'compliance-daily-check';
const CRON_PATTERN = '0 18 * * *'; // 18:00 every day.

export async function ensureComplianceDailyCheckScheduled(): Promise<void> {
  await complianceQueue.add(
    JOB_NAME,
    {},
    {
      repeat: { pattern: CRON_PATTERN, tz: 'Asia/Amman' },
      jobId: JOB_ID,
    },
  );
}

export function startComplianceDailyCheckWorker(): Worker {
  const worker = new Worker(
    COMPLIANCE_QUEUE,
    async (job) => {
      if (job.name !== JOB_NAME) return;
      const r = await runLowComplianceCheck();
      console.warn(
        `[compliance-daily] checked=${r.patientsChecked} notif=${r.notificationsCreated} cooldownSkip=${r.notificationsSkippedByCooldown}`,
      );
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    if (job?.name !== JOB_NAME) return;
    console.error(`[compliance-daily] failed: ${err.message}`);
  });

  return worker;
}
