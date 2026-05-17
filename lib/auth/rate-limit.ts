import { redis } from '@/lib/redis/client';

/**
 * Sliding-window-ish rate limiter using a single Redis key.
 *
 * Increment, set TTL on first hit only, compare to limit. Good enough for
 * login / OTP-request endpoints where we want a hard cap per minute.
 * Successful logins are NOT counted — call this only on the failure path
 * or as a pre-check, never on success.
 */
export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remainingTtlSeconds: number;
}

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const result = await redis.multi().incr(key).ttl(key).exec();
  // Drizzled by node-redis-style tuple [[err, count], [err, ttl]]
  const count = Number(result?.[0]?.[1] ?? 0);
  let ttl = Number(result?.[1]?.[1] ?? -1);
  if (ttl < 0) {
    // First hit (or expired) — set the window now so the counter clears
    // exactly windowSeconds from the first attempt.
    await redis.expire(key, windowSeconds);
    ttl = windowSeconds;
  }
  return {
    allowed: count <= limit,
    count,
    remainingTtlSeconds: ttl,
  };
}
