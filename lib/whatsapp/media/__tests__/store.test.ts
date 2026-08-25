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

import { storeInboundMedia } from '../store';

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

  it('a 4xx provider fetch is terminal → FAILED (not retried)', async () => {
    const fetch4xx = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    const r = await storeInboundMedia({ attachmentId: 'att-1', mediaUrl: 'https://x/m' }, fetch4xx);
    expect(r.status).toBe('FAILED');
  });

  it('a 5xx provider fetch throws so BullMQ retries', async () => {
    const fetch5xx = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(
      storeInboundMedia({ attachmentId: 'att-1', mediaUrl: 'https://x/m' }, fetch5xx),
    ).rejects.toThrow();
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
