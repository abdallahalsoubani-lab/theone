import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis/client', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    redis: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
    },
  };
});

const mod = await import('@/lib/redis/client');
const store = (mod as unknown as { __store: Map<string, string> }).__store;
const { cached } = await import('../cache');

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('cached', () => {
  it('runs the fetch on a cache miss and caches the result', async () => {
    const fetcher = vi.fn(async () => ({ value: 42 }));
    const first = await cached({ name: 'q', args: { x: 1 } }, fetcher);
    expect(first.value).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });

  it('returns the cached value without calling the fetcher on a hit', async () => {
    const fetcher = vi.fn(async () => ({ value: 'fresh' }));
    await cached({ name: 'q', args: { x: 1 } }, fetcher);
    const second = await cached({ name: 'q', args: { x: 1 } }, fetcher);
    expect(second.value).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('produces the same cache key regardless of args ordering', async () => {
    const fetcher = vi.fn(async () => ({ value: 1 }));
    await cached({ name: 'q', args: { a: 1, b: 2 } }, fetcher);
    await cached({ name: 'q', args: { b: 2, a: 1 } }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('produces different keys for different query names', async () => {
    const fetcher = vi.fn(async () => ({ value: 1 }));
    await cached({ name: 'a' }, fetcher);
    await cached({ name: 'b' }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(2);
  });

  it('revives Date instances from the cached JSON', async () => {
    const d = new Date('2026-06-01T10:00:00.000Z');
    const fetcher = vi.fn(async () => ({ when: d }));
    await cached({ name: 'd' }, fetcher);
    const hit = await cached({ name: 'd' }, fetcher);
    expect(hit.when).toBeInstanceOf(Date);
    expect((hit.when as Date).toISOString()).toBe(d.toISOString());
  });
});
