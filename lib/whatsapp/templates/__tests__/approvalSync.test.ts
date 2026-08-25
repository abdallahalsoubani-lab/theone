import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P52/P53 deploy — the daily approval sync: updates twilioApproved from live
 * WhatsApp status, and on a pending→approved flip logs "approved — switching"
 * + writes an audit row (so the switch moment is visible).
 */
const state = {
  rows: [] as Array<{ id: string; twilioApproved: boolean }>,
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  statusBySid: {} as Record<string, string>,
};

vi.mock('@/lib/env', () => ({ env: { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok' } }));
vi.mock('@/lib/system/actor', () => ({ SYSTEM_USER_ID: 'system' }));
vi.mock('@/lib/db', () => ({
  db: {
    whatsAppTemplate: {
      findUnique: vi.fn(async () => state.rows[0] ?? null),
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

import { syncTemplateApproval, type TrackedTemplate } from '../approvalSync';

const oneTracked: TrackedTemplate[] = [
  { name: 'appointment_reminder_single_v3', language: 'EN', sid: 'HXabc' },
];
const fetchStatus = (status: string) =>
  vi.fn(async () => ({
    ok: true,
    json: async () => ({ whatsapp: { status } }),
  })) as unknown as typeof fetch;

beforeEach(() => {
  state.rows = [{ id: 't1', twilioApproved: false }];
  state.updates = [];
  state.audits = [];
});

describe('syncTemplateApproval', () => {
  it('pending → still not approved, no flip, no audit', async () => {
    const r = await syncTemplateApproval(oneTracked, fetchStatus('pending'));
    expect(r.approved).toBe(0);
    expect((state.updates[0]!.data as Record<string, unknown>).twilioApproved).toBe(false);
    expect(
      (state.updates[0]!.data as Record<string, unknown>).twilioApprovalCheckedAt,
    ).toBeInstanceOf(Date);
    expect(state.audits).toHaveLength(0);
    expect(r.flipped).toEqual([]);
  });

  it('pending→approved FLIP → flag true, logs + audits the switch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await syncTemplateApproval(oneTracked, fetchStatus('approved'));
    expect(r.approved).toBe(1);
    expect(r.flipped).toEqual(['appointment_reminder_single_v3/EN']);
    expect((state.updates[0]!.data as Record<string, unknown>).twilioApproved).toBe(true);
    expect(state.audits).toHaveLength(1);
    expect((state.audits[0]!.data as { after: { event: string } }).after.event).toBe(
      'TEMPLATE_APPROVED_SWITCHED',
    );
    expect(warn.mock.calls.some((c) => String(c[0]).includes('approved — switching'))).toBe(true);
    warn.mockRestore();
  });

  it('already approved → refresh flag, NO duplicate audit (idempotent)', async () => {
    state.rows = [{ id: 't1', twilioApproved: true }];
    const r = await syncTemplateApproval(oneTracked, fetchStatus('approved'));
    expect(r.approved).toBe(1);
    expect(state.audits).toHaveLength(0);
  });

  it('a transient fetch failure leaves the flag untouched (no update)', async () => {
    const failFetch = vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await syncTemplateApproval(oneTracked, failFetch);
    expect(state.updates).toHaveLength(0);
  });
});
