import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P56 — download + store one inbound attachment: allowlist + size cap, the
 * failure paths (never a silent drop), and idempotency.
 */
const state = {
  attachment: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  puts: [] as Array<Record<string, unknown>>,
};

vi.mock('@/lib/db', () => ({
  db: {
    whatsAppAttachment: {
      findUnique: vi.fn(async () => state.attachment),
      update: vi.fn(async (a: Record<string, unknown>) => {
        state.updates.push(a);
        return {};
      }),
    },
  },
}));
vi.mock('@/lib/env', () => ({ env: { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok' } }));
vi.mock('@/lib/storage/client', () => ({
  STORAGE_BUCKET: 'b',
  s3: {
    send: vi.fn(async (cmd: { input: Record<string, unknown> }) => {
      state.puts.push(cmd.input);
      return {};
    }),
  },
}));

import { isRetryableMediaStatus, storeInboundMedia } from '../store';

const fetchOk = (bytes: number, ct = 'image/jpeg') =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => ct },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  })) as unknown as typeof fetch;

beforeEach(() => {
  state.attachment = {
    id: 'att-1',
    status: 'PENDING',
    contentType: 'image/jpeg',
    receivedAt: new Date('2030-05-10T00:00:00Z'),
  };
  state.updates = [];
  state.puts = [];
});

describe('storeInboundMedia', () => {
  it('downloads with auth, stores the object, marks STORED with size + key', async () => {
    const r = await storeInboundMedia(
      { attachmentId: 'att-1', mediaUrl: 'https://x/m' },
      fetchOk(1000),
    );
    expect(r.status).toBe('STORED');
    expect(state.puts).toHaveLength(1);
    const upd = state.updates[0]!.data as Record<string, unknown>;
    expect(upd.status).toBe('STORED');
    expect(upd.sizeBytes).toBe(1000);
    expect(String(upd.storageKey)).toMatch(/^whatsapp-media\/20300510\/att-1\.jpg$/);
  });

  it('rejects a disallowed content type → FAILED, no fetch of bytes stored', async () => {
    state.attachment = { ...state.attachment!, contentType: 'application/x-msdownload' };
    const r = await storeInboundMedia(
      { attachmentId: 'att-1', mediaUrl: 'https://x/m' },
      fetchOk(10),
    );
    expect(r.status).toBe('FAILED');
    expect((state.updates[0]!.data as Record<string, unknown>).status).toBe('FAILED');
    expect(state.puts).toHaveLength(0);
  });

  it('rejects an oversize file → FAILED (image cap 5MB)', async () => {
    const r = await storeInboundMedia(
      { attachmentId: 'att-1', mediaUrl: 'https://x/m' },
      fetchOk(6 * 1024 * 1024),
    );
    expect(r.status).toBe('FAILED');
    expect(state.puts).toHaveLength(0);
  });

  // P62-session follow-up: production showed 8 of ~120 attachments dying on
  // a FIRST-fetch 404 (Twilio announces the media before it is readable).
  it('a 404 on a non-final attempt THROWS so BullMQ retries — no FAILED row written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch404 = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(
      storeInboundMedia({ attachmentId: 'att-1', mediaUrl: 'https://x/m' }, fetch404, {
        attempt: 1,
        maxAttempts: 6,
      }),
    ).rejects.toThrow(/404/);
    expect(state.updates).toHaveLength(0);
    warn.mockRestore();
  });

  it('a 404 on the FINAL attempt → FAILED, reason carries the attempt budget', async () => {
    const fetch404 = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    const r = await storeInboundMedia(
      { attachmentId: 'att-1', mediaUrl: 'https://x/m' },
      fetch404,
      {
        attempt: 6,
        maxAttempts: 6,
      },
    );
    expect(r.status).toBe('FAILED');
    expect(r.reason).toBe('provider fetch 404 (after 6 attempts)');
    expect((state.updates[0]!.data as Record<string, unknown>).status).toBe('FAILED');
  });

  it('401/403/410 are terminal on ANY attempt (credentials / forbidden / gone do not heal)', async () => {
    for (const status of [401, 403, 410]) {
      state.updates = [];
      const f = vi.fn(async () => ({ ok: false, status })) as unknown as typeof fetch;
      const r = await storeInboundMedia({ attachmentId: 'att-1', mediaUrl: 'https://x/m' }, f, {
        attempt: 1,
        maxAttempts: 6,
      });
      expect(r.status).toBe('FAILED');
      expect(r.reason).toBe(`provider fetch ${status}`);
    }
  });

  it('a 5xx on a non-final attempt throws so BullMQ retries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch5xx = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(
      storeInboundMedia({ attachmentId: 'att-1', mediaUrl: 'https://x/m' }, fetch5xx, {
        attempt: 2,
        maxAttempts: 3,
      }),
    ).rejects.toThrow();
    warn.mockRestore();
  });

  it('a 5xx on the FINAL attempt → FAILED (a row is never left PENDING after the budget)', async () => {
    const fetch5xx = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const r = await storeInboundMedia(
      { attachmentId: 'att-1', mediaUrl: 'https://x/m' },
      fetch5xx,
      {
        attempt: 3,
        maxAttempts: 3,
      },
    );
    expect(r.status).toBe('FAILED');
    expect(r.reason).toBe('provider fetch 503 (after 3 attempts)');
  });

  it('the default attempt info is a single final attempt (repair script path)', async () => {
    const fetch404 = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    const r = await storeInboundMedia({ attachmentId: 'att-1', mediaUrl: 'https://x/m' }, fetch404);
    expect(r.status).toBe('FAILED');
    expect(r.reason).toBe('provider fetch 404');
  });

  it('isRetryableMediaStatus: 404/408/429/5xx yes; 400/401/403/410/413/415 no', () => {
    for (const s of [404, 408, 429, 500, 502, 503]) expect(isRetryableMediaStatus(s)).toBe(true);
    for (const s of [400, 401, 403, 410, 413, 415]) expect(isRetryableMediaStatus(s)).toBe(false);
  });

  it('is idempotent — an already-STORED row is skipped', async () => {
    state.attachment = { ...state.attachment!, status: 'STORED' };
    const r = await storeInboundMedia(
      { attachmentId: 'att-1', mediaUrl: 'https://x/m' },
      fetchOk(10),
    );
    expect(r.status).toBe('SKIPPED');
    expect(state.puts).toHaveLength(0);
  });
});
