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
import { startWhatsappOutboundWorker } from './whatsapp';
import {
  ensureTemplateApprovalSyncScheduled,
  ensureWhatsappMediaRetentionScheduled,
  startWhatsappMediaWorker,
} from './whatsappMedia';

import { sessionMaintenanceQueue } from '@/lib/queue/queues';

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
const whatsappMediaWorker = startWhatsappMediaWorker();
console.warn(`[workers] whatsapp media worker listening on queue=${whatsappMediaWorker.name}`);
// Register the daily inbound-media retention sweep (idempotent via jobId).
void ensureWhatsappMediaRetentionScheduled().catch((err: unknown) => {
  console.error('[workers] whatsapp media retention registration failed', err);
});
void ensureTemplateApprovalSyncScheduled().catch((err: unknown) => {
  console.error('[workers] template approval sync registration failed', err);
});
// Session auto-complete is DISABLED (PT-B3 item 1, owner ruling): a session
// may legitimately run past its slot, and closing it automatically records a
// clinical event that never happened. Completion is a human action again —
// the desk closes the session from the arrivals board or the calendar side
// panel, and an over-running session is flagged with the "Overdue +Nm" badge
// instead of being silently ended.
//
// The worker is not started, so any delayed job still sitting in Redis from a
// previous deployment simply never fires; nothing new is enqueued either (see
// lib/appointments/services.ts). The queue + job modules are kept intact so
// this is one commit to reverse if the clinic changes its mind.
//
// Drop the legacy 15-min repeatable sweep if an older deployment ever
// registered it in this Redis.
void sessionMaintenanceQueue
  .removeRepeatable('sessionAutoComplete', { pattern: '*/15 * * * *', tz: 'Asia/Amman' })
  .then((removed) => {
    if (removed) console.warn('[workers] removed legacy session auto-complete repeatable');
  })
  .catch(() => {});

// Keep the process alive while the workers run. Graceful shutdown on SIGINT.
async function shutdown(signal: string) {
  console.warn(`[workers] received ${signal}, closing workers…`);
  await Promise.all([
    reminderWorker.close(),
    homeReminderWorker.close(),
    complianceWorker.close(),
    whatsappWorker.close(),
    whatsappMediaWorker.close(),
  ]);
  console.warn('[workers] all workers closed; exiting');
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
