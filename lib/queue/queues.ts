import { Queue } from 'bullmq';

import { queueRedis } from './client';

/**
 * Named BullMQ queues used across the application.
 *
 *   reminders            — 30-minute (configurable) WhatsApp reminders for
 *                          scheduled appointments. Implemented in this prompt.
 *   homeProgramReminders — daily exercise reminders. Wired in Prompt 10.
 *   whatsappOutbound    — generic outbound message queue (delivery status
 *                          tracking, retries). Wired in Prompt 8.
 *
 * Workers in `workers/*.ts` subscribe to each. Producer code (server actions)
 * imports the queue and calls `add` / `removeJobs` to enqueue or cancel.
 */
export const REMINDER_QUEUE = 'reminders';
export const HOME_PROGRAM_QUEUE = 'homeProgramReminders';
export const WHATSAPP_OUTBOUND_QUEUE = 'whatsappOutbound';

export const reminderQueue = new Queue(REMINDER_QUEUE, {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 }, // keep a week of history
    removeOnFail: { age: 60 * 60 * 24 * 30 }, // keep failures longer for debugging
  },
});

export const homeProgramQueue = new Queue(HOME_PROGRAM_QUEUE, {
  connection: queueRedis,
});

export const whatsappOutboundQueue = new Queue(WHATSAPP_OUTBOUND_QUEUE, {
  connection: queueRedis,
  defaultJobOptions: {
    // Three attempts with exponential backoff. Retryable WhatsApp errors
    // (network, 5xx, rate limit) hit this; terminal ones (invalid number,
    // template not approved) bypass it via the worker's `failedReason`
    // pattern: it catches the error, writes the FAILED row, and re-throws
    // a marker so BullMQ does not retry.
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
});
