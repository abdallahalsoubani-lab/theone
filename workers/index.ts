/**
 * Worker process entrypoint — started by `pnpm workers:start`.
 *
 * Spawns one worker per queue. Each worker is its own concurrent unit
 * (BullMQ default concurrency 1; adjust per worker as throughput needs grow).
 *
 * In dev:  `pnpm workers:start` runs this file via tsx.
 * In prod: deploy as a separate Node service so the web app and the worker
 *          can be scaled independently. The web app's Redis-backed enqueue
 *          continues to work regardless of whether the worker is running —
 *          jobs accumulate until a worker picks them up.
 *
 * Queues registered here:
 *   reminders             — appointment 30-min reminder (Prompt 7).
 *   homeProgramReminders  — home-exercise recurring reminder (Prompt 10).
 *   complianceChecks      — daily 18:00 low-compliance scan (Prompt 10).
 *   whatsappOutbound      — single chokepoint for every outbound WhatsApp
 *                           message (Prompt 8). The reminder workers enqueue
 *                           here; OTP, credentials, confirmations, cancellations
 *                           and admin resends also enqueue here so retries,
 *                           audit, and rate limiting are uniform.
 *
 * Each worker subscribes to ONE queue. This is deliberate — earlier the
 * three reminder-class workers all attached to `reminders` and
 * distinguished by `if (job.name !== '...') return;` early-returns. That
 * caused a race: a job posted by one worker could be silently consumed
 * by another worker that early-returned without doing the real work.
 */

import {
  ensureComplianceDailyCheckScheduled,
  startComplianceDailyCheckWorker,
} from './complianceDailyCheck';
import { startHomeReminderWorker } from './homeReminder';
import { startReminderWorker } from './reminder';
import {
  ensureSessionAutoCompleteScheduled,
  startSessionAutoCompleteWorker,
} from './sessionAutoComplete';
import { startWhatsappOutboundWorker } from './whatsapp';

console.warn('[workers] starting…');
const reminderWorker = startReminderWorker();
console.warn(`[workers] appointment reminder worker listening on queue=${reminderWorker.name}`);
const homeReminderWorker = startHomeReminderWorker();
console.warn(`[workers] home reminder worker listening on queue=${homeReminderWorker.name}`);
const complianceWorker = startComplianceDailyCheckWorker();
console.warn(`[workers] compliance daily check worker listening on queue=${complianceWorker.name}`);
// Register the recurring 18:00-local daily check (idempotent via jobId).
void ensureComplianceDailyCheckScheduled().catch((err: unknown) => {
  console.error('[workers] compliance daily check registration failed', err);
});
const whatsappWorker = startWhatsappOutboundWorker();
console.warn(`[workers] whatsapp outbound worker listening on queue=${whatsappWorker.name}`);
const sessionAutoCompleteWorker = startSessionAutoCompleteWorker();
console.warn(
  `[workers] session auto-complete worker listening on queue=${sessionAutoCompleteWorker.name}`,
);
// Register the recurring 15-min overdue-session sweep (idempotent via jobId).
void ensureSessionAutoCompleteScheduled().catch((err: unknown) => {
  console.error('[workers] session auto-complete registration failed', err);
});

// Keep the process alive while the workers run. Graceful shutdown on SIGINT.
async function shutdown(signal: string) {
  console.warn(`[workers] received ${signal}, closing workers…`);
  await Promise.all([
    reminderWorker.close(),
    homeReminderWorker.close(),
    complianceWorker.close(),
    whatsappWorker.close(),
    sessionAutoCompleteWorker.close(),
  ]);
  console.warn('[workers] all workers closed; exiting');
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
