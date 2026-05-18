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
 */

import { startReminderWorker } from './reminder';

console.warn('[workers] starting…');
const reminderWorker = startReminderWorker();
console.warn(`[workers] reminder worker listening on queue=${reminderWorker.name}`);

// Keep the process alive while the workers run. Graceful shutdown on SIGINT.
async function shutdown(signal: string) {
  console.warn(`[workers] received ${signal}, closing workers…`);
  await reminderWorker.close();
  console.warn('[workers] all workers closed; exiting');
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
