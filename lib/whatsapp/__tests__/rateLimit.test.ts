import { describe, expect, it } from 'vitest';

import {
  GLOBAL_LIMIT_PER_MINUTE,
  PER_PHONE_LIMIT_PER_MINUTE,
  makeOutboundRateLimiter,
} from '../rateLimit';

function fakeRedis() {
  const counters = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    counters,
    ttls,
    async incr(key: string) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async pexpire(key: string, ms: number) {
      ttls.set(key, ms);
      return 1;
    },
    async pttl(key: string) {
      return ttls.get(key) ?? -1;
    },
  };
}

describe('makeOutboundRateLimiter — per-phone bucket', () => {
  it(`allows up to ${PER_PHONE_LIMIT_PER_MINUTE} sends per phone per minute`, async () => {
    const redis = fakeRedis();
    const limiter = makeOutboundRateLimiter({ redis, now: () => 0 });
    for (let i = 0; i < PER_PHONE_LIMIT_PER_MINUTE; i++) {
      const decision = await limiter.acquire('+962790000000');
      expect(decision.allowed).toBe(true);
    }
  });

  it('rejects the 6th send within the same window and returns delayMs > 0', async () => {
    const redis = fakeRedis();
    const limiter = makeOutboundRateLimiter({ redis, now: () => 0 });
    for (let i = 0; i < PER_PHONE_LIMIT_PER_MINUTE; i++) {
      await limiter.acquire('+962790000000');
    }
    const decision = await limiter.acquire('+962790000000');
    expect(decision.allowed).toBe(false);
    expect(decision.delayMs).toBeGreaterThan(0);
  });

  it('starts a fresh window for the next 60-second bucket', async () => {
    const redis = fakeRedis();
    let now = 0;
    const limiter = makeOutboundRateLimiter({ redis, now: () => now });
    for (let i = 0; i < PER_PHONE_LIMIT_PER_MINUTE; i++) {
      await limiter.acquire('+962790000000');
    }
    // Advance into the next bucket.
    now = 70_000;
    const decision = await limiter.acquire('+962790000000');
    expect(decision.allowed).toBe(true);
  });

  it('isolates per-phone counters across recipients', async () => {
    const redis = fakeRedis();
    const limiter = makeOutboundRateLimiter({ redis, now: () => 0 });
    for (let i = 0; i < PER_PHONE_LIMIT_PER_MINUTE; i++) {
      await limiter.acquire('+962790000000');
    }
    const second = await limiter.acquire('+962790000001');
    expect(second.allowed).toBe(true);
  });
});

describe('makeOutboundRateLimiter — global bucket', () => {
  it(`rejects beyond the global ${GLOBAL_LIMIT_PER_MINUTE}/minute even across different phones`, async () => {
    const redis = fakeRedis();
    const limiter = makeOutboundRateLimiter({ redis, now: () => 0 });
    // Each distinct phone gets its own per-phone counter so the per-phone
    // cap never trips; this proves the global cap is what enforces.
    for (let i = 0; i < GLOBAL_LIMIT_PER_MINUTE; i++) {
      const phone = `+96279000${String(i).padStart(4, '0')}`;
      const decision = await limiter.acquire(phone);
      expect(decision.allowed).toBe(true);
    }
    const overflow = await limiter.acquire('+96279999');
    expect(overflow.allowed).toBe(false);
    expect(overflow.delayMs).toBeGreaterThan(0);
  });
});
