import { Redis } from 'ioredis';

/**
 * BullMQ-compatible Redis connection.
 *
 * Note: BullMQ requires `maxRetriesPerRequest: null` and
 * `enableReadyCheck: false` for the connection it uses for blocking
 * commands (the worker). Mirror that here so workers and the queue
 * producer share the same singleton.
 */
const globalForRedis = globalThis as unknown as { queueRedis?: Redis };

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const queueRedis: Redis =
  globalForRedis.queueRedis ??
  new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.queueRedis = queueRedis;
}
