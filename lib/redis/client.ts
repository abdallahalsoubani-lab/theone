import { Redis } from 'ioredis';

/**
 * Redis singleton — same hot-reload guard pattern as the Prisma client.
 * Connects lazily on first command; tests that don't touch Redis don't pay
 * the connection cost.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis };

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis: Redis =
  globalForRedis.redis ??
  new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
