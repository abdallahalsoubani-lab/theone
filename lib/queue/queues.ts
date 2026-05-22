import { Queue } from 'bullmq';

import { queueRedis } from './client';

/**
 * Named BullMQ queues used across the application.
 *
 *   reminders            — kept for backward compat. New code should use one
 *                          of the per-job-class queues below; this still
 *                          exists because the legacy `reminderQueue` export
 *                          is the public API the rest of the codebase uses
 *                          (alias of appointmentReminderQueue).
 *   homeProgramReminders — daily exercise reminders.
 *   complianceChecks     — daily low-compliance scan cron.
 *   whatsappOutbound     — generic outbound message queue (delivery status
 *                          tracking, retries). Wired in Prompt 8.
 *
 * Workers in `workers/*.ts` each subscribe to ONE queue — separate queues per
 * job class prevent the multi-worker race where a job posted by `reminder`
 * could be silently consumed by the `homeReminder` or `compliance` worker
 * (which would early-return without enqueueing the outbound). See the
 * worker-race incident in PROJECT_UNDERSTANDING.md §14.
 */
export const REMINDER_QUEUE = 'reminders';
export const HOME_PROGRAM_QUEUE = 'homeProgramReminders';
export const COMPLIANCE_QUEUE = 'complianceChecks';
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
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 },
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
});

export const complianceQueue = new Queue(COMPLIANCE_QUEUE, {
  connection: queueRedis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 30 },
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
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
