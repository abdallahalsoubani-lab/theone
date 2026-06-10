import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const state = { kioskToken: null as string | null, displayToken: null as string | null };
  return {
    __state: state,
    db: {
      clinicSettings: {
        findFirst: vi.fn(
          async ({ where }: { where: { kioskToken?: string; displayToken?: string } }) => {
            if ('kioskToken' in where) {
              return where.kioskToken && where.kioskToken === state.kioskToken
                ? { id: 'default' }
                : null;
            }
            return where.displayToken && where.displayToken === state.displayToken
              ? { id: 'default' }
              : null;
          },
        ),
      },
    },
  };
});

import * as dbModule from '@/lib/db';

import { generateAccessToken, validateArrivalsToken } from '../tokens';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const state = (dbModule as any).__state as {
  kioskToken: string | null;
  displayToken: string | null;
};

beforeEach(() => {
  state.kioskToken = null;
  state.displayToken = null;
});

describe('generateAccessToken', () => {
  it('produces a long url-safe token, unique per call', () => {
    const a = generateAccessToken();
    const b = generateAccessToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('validateArrivalsToken', () => {
  it('rejects empty / short / wrong tokens (gate stays closed)', async () => {
    state.kioskToken = generateAccessToken();
    expect(await validateArrivalsToken('kiosk', undefined)).toBe(false);
    expect(await validateArrivalsToken('kiosk', '')).toBe(false);
    expect(await validateArrivalsToken('kiosk', 'short')).toBe(false);
    expect(await validateArrivalsToken('kiosk', 'x'.repeat(32))).toBe(false);
  });

  it('accepts the matching token for the right surface only', async () => {
    state.kioskToken = generateAccessToken();
    state.displayToken = generateAccessToken();
    expect(await validateArrivalsToken('kiosk', state.kioskToken)).toBe(true);
    expect(await validateArrivalsToken('display', state.displayToken)).toBe(true);
    // A kiosk token must not unlock the display surface.
    expect(await validateArrivalsToken('display', state.kioskToken)).toBe(false);
  });

  it('stops working once revoked (token set to null)', async () => {
    const tok = generateAccessToken();
    state.kioskToken = tok;
    expect(await validateArrivalsToken('kiosk', tok)).toBe(true);
    state.kioskToken = null; // admin revoke
    expect(await validateArrivalsToken('kiosk', tok)).toBe(false);
  });
});
