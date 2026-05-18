import { redis } from '@/lib/redis/client';

/**
 * Tiny Redis-backed cache for analytics queries (Prompt 11 §4.2).
 *
 * Analytics queries scan large date ranges (clinic utilization,
 * monthly trend, cancellation categories) and the dashboard reloads
 * on every page render. A 5-minute cache keeps charts feeling instant
 * without becoming stale enough to mislead.
 *
 * - Key shape: `analytics:{queryName}:{argsHash}`.
 * - TTL: 5 minutes (DEFAULT_TTL_SECONDS). Override per call when a
 *   query is naturally slower to change (e.g. `getActivePatientCount`
 *   is fine with 15 minutes).
 * - Connection failures degrade gracefully — if Redis is down the
 *   inner query still runs; the dashboard just loses its cache layer.
 *
 * The cache is intentionally side-by-side with the queries rather
 * than wrapping them transparently: a query that needs cache control
 * (force-fresh after a write, custom TTL) opts in by calling
 * `cached(...)`; queries that are inherently uncached stay simple.
 */

const DEFAULT_TTL_SECONDS = 5 * 60;

export async function cached<T>(
  key: { name: string; args?: Record<string, unknown> },
  fetch: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<T> {
  const cacheKey = `analytics:${key.name}:${hashArgs(key.args)}`;
  try {
    const hit = await redis.get(cacheKey);
    if (hit) {
      return JSON.parse(hit, reviveDates) as T;
    }
  } catch (err) {
    console.warn('[analytics.cache] read failed, falling through to query', err);
  }
  const fresh = await fetch();
  try {
    await redis.set(cacheKey, JSON.stringify(fresh), 'EX', ttlSeconds);
  } catch (err) {
    console.warn('[analytics.cache] write failed', err);
  }
  return fresh;
}

/**
 * Stable string hash of an args object. Sorts keys so call-site
 * argument order doesn't fragment the cache namespace.
 */
function hashArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return 'noargs';
  const sorted = Object.keys(args)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = args[k];
      return acc;
    }, {});
  return JSON.stringify(sorted, (_k, v) => (v instanceof Date ? v.toISOString() : v));
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_REGEX.test(value)) {
    return new Date(value);
  }
  return value;
}
