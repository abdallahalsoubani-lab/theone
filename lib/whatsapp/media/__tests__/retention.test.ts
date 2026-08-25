import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P56 — 90-day retention: binaries older than the window are deleted, rows
 * kept as EXPIRED markers, window read from settings, idempotent, audited.
 */
const state = {
  windowDays: 90,
  stale: [] as Array<{ id: string; storageKey: string | null }>,
  updates: [] as Array<Record<string, unknown>>,
  deletes: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
};

vi.mock('@/lib/db', () => ({
  db: {
    clinicSettings: {
      findUnique: vi.fn(async () => ({ whatsappMediaRetentionDays: state.windowDays })),
    },
    whatsAppAttachment: {
      findMany: vi.fn(async () => state.stale),
      update: vi.fn(async (a: Record<string, unknown>) => {
        state.updates.push(a);
        return {};
      }),
    },
    auditLog: {
      create: vi.fn(async (a: Record<string, unknown>) => {
        state.audits.push(a);
        return {};
      }),
    },
  },
}));
vi.mock('@/lib/system/actor', () => ({ SYSTEM_USER_ID: 'system' }));
vi.mock('@/lib/storage/client', () => ({
  STORAGE_BUCKET: 'b',
  s3: {
    send: vi.fn(async (cmd: { input: Record<string, unknown> }) => {
      state.deletes.push(cmd.input);
      return {};
    }),
  },
}));

import { runWhatsappMediaRetention } from '../retention';

beforeEach(() => {
  state.windowDays = 90;
  state.stale = [];
  state.updates = [];
  state.deletes = [];
  state.audits = [];
});

describe('runWhatsappMediaRetention', () => {
  it('deletes each stale object, marks EXPIRED + deletedAt, keeps the row, audits once', async () => {
    state.stale = [
      { id: 'a1', storageKey: 'whatsapp-media/1/a1.jpg' },
      { id: 'a2', storageKey: 'whatsapp-media/1/a2.mp4' },
    ];
    const r = await runWhatsappMediaRetention(new Date('2030-05-10T00:00:00Z'));
    expect(r.deleted).toBe(2);
    expect(state.deletes).toHaveLength(2);
    for (const u of state.updates) {
      const d = u.data as Record<string, unknown>;
      expect(d.status).toBe('EXPIRED');
      expect(d.deletedAt).toBeInstanceOf(Date);
      expect(d.storageKey).toBeNull();
    }
    // Aggregate audit: ONE row per run with counts.
    expect(state.audits).toHaveLength(1);
    expect((state.audits[0]!.data as { after: { event: string } }).after.event).toBe(
      'WA_MEDIA_RETENTION_RUN',
    );
  });

  it('idempotent — a run with nothing stale deletes nothing and writes no audit', async () => {
    state.stale = [];
    const r = await runWhatsappMediaRetention();
    expect(r.deleted).toBe(0);
    expect(state.deletes).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it('reads the window from settings (queries with the configured cutoff)', async () => {
    state.windowDays = 30;
    const r = await runWhatsappMediaRetention();
    expect(r.windowDays).toBe(30);
  });
});
