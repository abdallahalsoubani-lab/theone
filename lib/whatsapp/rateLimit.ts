import type { Redis } from 'ioredis';

/**
 * Token-bucket rate limiter built on Redis INCR. Two scopes:
 *
 *   - per-phone:   max 5 sends / minute / recipient
 *   - global:      max 100 sends / minute across the whole clinic
 *
 * Defensive defaults. Twilio Sandbox and Meta Cloud API both rate-limit
 * upstream; these caps protect us from a runaway loop (e.g., a bug that
 * keeps re-enqueueing the same job) before the provider returns 429.
 *
 * The bucket is implemented as a counter with PEXPIRE on first increment
 * of a window. If the limit is exceeded, the worker delays the job by the
 * remaining window so the message goes out shortly rather than failing.
 */

export const PER_PHONE_LIMIT_PER_MINUTE = 5;
export const GLOBAL_LIMIT_PER_MINUTE = 100;
const WINDOW_MS = 60_000;

export interface RateLimitDecision {
  allowed: boolean;
  /** When allowed=false, how long the caller should wait before retrying. */
  delayMs: number;
}

function key(scope: 'phone' | 'global', id: string, now: number): string {
  // Sliding 60-second window keyed by floor(now/60s) so each window has its
  // own counter that expires automatically. Two windows can be live at once
  // — that's fine; the cap holds per-window.
  const bucket = Math.floor(now / WINDOW_MS);
  return `wa:ratelimit:${scope}:${id}:${bucket}`;
}

async function check(
  redis: Pick<Redis, 'incr' | 'pexpire' | 'pttl'>,
  fullKey: string,
  limit: number,
): Promise<RateLimitDecision> {
  const current = await redis.incr(fullKey);
  if (current === 1) {
    await redis.pexpire(fullKey, WINDOW_MS);
  }
  if (current <= limit) {
    return { allowed: true, delayMs: 0 };
  }
  // Over the cap — undo the increment is not possible cheaply; just delay
  // until the window rolls. PTTL returns ms left, or -1 if the key has no
  // TTL (race with eviction); fall back to the full window in that case.
  const ttl = await redis.pttl(fullKey);
  return { allowed: false, delayMs: ttl > 0 ? ttl : WINDOW_MS };
}

export interface OutboundRateLimiterDeps {
  redis: Pick<Redis, 'incr' | 'pexpire' | 'pttl'>;
  now?: () => number;
}

export interface OutboundRateLimiter {
  /**
   * Returns the longest delay across both scopes. allowed=true means both
   * scopes accepted the message; allowed=false means at least one was
   * exhausted and the caller should re-enqueue with the returned delay.
   */
  acquire(recipientPhone: string): Promise<RateLimitDecision>;
}

export function makeOutboundRateLimiter(deps: OutboundRateLimiterDeps): OutboundRateLimiter {
  const now = deps.now ?? (() => Date.now());
  return {
    async acquire(recipientPhone: string): Promise<RateLimitDecision> {
      const t = now();
      const perPhone = await check(
        deps.redis,
        key('phone', recipientPhone, t),
        PER_PHONE_LIMIT_PER_MINUTE,
      );
      const global = await check(deps.redis, key('global', 'all', t), GLOBAL_LIMIT_PER_MINUTE);
      if (perPhone.allowed && global.allowed) return { allowed: true, delayMs: 0 };
      return {
        allowed: false,
        delayMs: Math.max(perPhone.delayMs, global.delayMs),
      };
    },
  };
}
