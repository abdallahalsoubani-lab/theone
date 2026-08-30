import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P57 + P57b — broadcast script tests.
 *
 * The script sends DIRECTLY through the provider module with its own
 * bookkeeping: the P48 dispatch layer, the P51 silent-mode gate, and the
 * BullMQ outbound queue must never be consulted (tripwire spies + a source
 * scan below), and no WhatsAppConversation row is ever created or bumped
 * (approved decision — 1,689 upserts would flood the P49 inbox).
 */

// Keep the module-level imports of the script inert; every DB access in
// these tests goes through explicitly injected deps instead.
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/whatsapp', () => ({
  whatsapp: { sendTemplate: vi.fn(), healthCheck: vi.fn() },
}));
vi.mock('@/lib/whatsapp/templates/approval', () => ({
  isTemplateApproved: vi.fn(async () => true),
}));
vi.mock('@/lib/whatsapp/templates/approvalSync', () => ({
  syncTemplateApproval: vi.fn(async () => ({ checked: 1, approved: 1, flipped: [] })),
}));

// Tripwires — the broadcast must be exempt from silent mode (P51) and never
// touch the dispatch layer (P48) or the outbound queue. The script does not
// even import these modules; if a future edit wires them in, these spies
// catch the call and the source scan below catches the import.
const silentModeSpy = vi.fn(async () => true); // silent mode ON — must be ignored
const holdForOutboxSpy = vi.fn();
const dispatchSpy = vi.fn();
const enqueueSpy = vi.fn();
vi.mock('@/lib/whatsapp/silent-mode', () => ({
  isSilentModeOn: silentModeSpy,
  holdForOutbox: holdForOutboxSpy,
}));
vi.mock('@/lib/whatsapp/dispatch/service', () => ({ dispatch: dispatchSpy }));
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({ enqueueWhatsappOutbound: enqueueSpy }));

import { WhatsAppError } from '@/lib/whatsapp/errors';

import {
  applyRun,
  type BroadcastDb,
  type BroadcastDeps,
  CAMPAIGN,
  CANARY_PHONE,
  DEFAULT_DAILY_CAP,
  dryRun,
  isDailyLimitError,
  isInsideSendWindow,
  loadCampaign,
  maskPhone,
  parseCampaignCsv,
  reportRun,
  TEMPLATE_NAME,
  TEMPLATE_SID,
} from '../broadcast-number-change';

/** Index-access guard — strict TS (`noUncheckedIndexedAccess`) helper. */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value');
  return v;
}

// ─── In-memory fake DB ─────────────────────────────────────────────────────

interface FakeRecipient {
  id: string;
  campaign: string;
  phone: string;
  name: string | null;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';
  failReason: string | null;
  sentAt: Date | null;
  messageId: string | null;
  createdAt: Date;
}

interface FakeStore {
  recipients: FakeRecipient[];
  messages: Array<Record<string, unknown> & { id: string }>;
  audits: Array<Record<string, unknown>>;
  templateUpserts: Array<Record<string, unknown>>;
  conversationCalls: number;
}

function makeFakeDb(store: FakeStore): BroadcastDb {
  let seq = 0;
  const base = Date.UTC(2026, 7, 28, 12, 0, 0);
  const matches = (r: FakeRecipient, where: Record<string, unknown>): boolean => {
    if (where.campaign && r.campaign !== where.campaign) return false;
    if (where.status && r.status !== where.status) return false;
    const sentAt = where.sentAt as { gte: Date; lt: Date } | undefined;
    if (sentAt) {
      if (!r.sentAt) return false;
      if (r.sentAt < sentAt.gte || r.sentAt >= sentAt.lt) return false;
    }
    return true;
  };
  const sorted = () =>
    [...store.recipients].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );

  const db = {
    broadcastRecipient: {
      createMany: async (args: {
        data: Array<{ campaign: string; phone: string; name: string | null }>;
        skipDuplicates: boolean;
      }) => {
        let count = 0;
        for (const d of args.data) {
          const dup = store.recipients.some(
            (r) => r.campaign === d.campaign && r.phone === d.phone,
          );
          if (dup) {
            if (!args.skipDuplicates) throw new Error('unique violation');
            continue;
          }
          seq += 1;
          store.recipients.push({
            id: `r${String(seq).padStart(5, '0')}`,
            campaign: d.campaign,
            phone: d.phone,
            name: d.name,
            status: 'PENDING',
            failReason: null,
            sentAt: null,
            messageId: null,
            createdAt: new Date(base + seq * 1000),
          });
          count += 1;
        }
        return { count };
      },
      count: async (args: { where: Record<string, unknown> }) =>
        store.recipients.filter((r) => matches(r, args.where)).length,
      findMany: async (args: {
        where: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
        select: Record<string, boolean>;
      }) => {
        const rows = sorted().filter((r) => matches(r, args.where));
        return (args.take != null ? rows.slice(0, args.take) : rows).map((r) => ({
          id: r.id,
          phone: r.phone,
          name: r.name,
          messageId: r.messageId,
          failReason: r.failReason,
        }));
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.recipients.find((r) => r.id === args.where.id);
        if (!row) throw new Error(`no row ${args.where.id}`);
        Object.assign(row, args.data);
        return row;
      },
      groupBy: async (args: { where: Record<string, unknown> }) => {
        const counts = new Map<string, number>();
        for (const r of store.recipients.filter((x) => matches(x, args.where))) {
          counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
        }
        return [...counts.entries()].map(([status, n]) => ({ status, _count: { _all: n } }));
      },
    },
    whatsAppMessage: {
      create: async (args: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `m${String(seq).padStart(5, '0')}`, ...args.data };
        store.messages.push(row);
        return row;
      },
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        store.messages
          .filter((m) => args.where.id.in.includes(m.id))
          .map((m) => ({ id: m.id, status: m.status as string })),
    },
    whatsAppTemplate: {
      upsert: async (args: Record<string, unknown>) => {
        store.templateUpserts.push(args);
        return { id: 'tpl1' };
      },
      findUnique: async () => ({ id: 'tpl1' }),
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        store.audits.push(args.data);
        return args.data;
      },
    },
    // NOT part of BroadcastDb — present only so a regression that starts
    // bumping conversations is caught by the assertion, not a TypeError.
    whatsAppConversation: {
      upsert: async () => {
        store.conversationCalls += 1;
        return {};
      },
      create: async () => {
        store.conversationCalls += 1;
        return {};
      },
    },
  };
  return db as unknown as BroadcastDb;
}

// 11:00 Amman (UTC+3) — inside the 10:00–18:00 window.
const INSIDE_WINDOW = new Date('2026-08-29T08:00:00Z');

function makeDeps(overrides: Partial<BroadcastDeps> = {}): {
  deps: BroadcastDeps;
  store: FakeStore;
  provider: { sendTemplate: ReturnType<typeof vi.fn>; healthCheck: ReturnType<typeof vi.fn> };
  logs: string[];
} {
  const store: FakeStore = {
    recipients: [],
    messages: [],
    audits: [],
    templateUpserts: [],
    conversationCalls: 0,
  };
  const logs: string[] = [];
  let sidSeq = 0;
  const provider = {
    sendTemplate: vi.fn(async (_args: { recipientPhone: string }) => {
      void _args;
      sidSeq += 1;
      return { providerMessageId: `SM${String(sidSeq).padStart(4, '0')}`, status: 'SENT' as const };
    }),
    healthCheck: vi.fn(async () => true),
  };
  const deps: BroadcastDeps = {
    db: makeFakeDb(store),
    provider,
    syncApproval: vi.fn(async () => ({ checked: 1, approved: 1, flipped: [] })),
    isApproved: vi.fn(async () => true),
    now: () => INSIDE_WINDOW,
    sleep: vi.fn(async () => undefined),
    log: (m) => logs.push(m),
    ...overrides,
  };
  return { deps, store, provider: deps.provider as typeof provider, logs };
}

function seedPending(store: FakeStore, n: number, prefix = '+96279'): void {
  const base = Date.UTC(2026, 7, 28, 10, 0, 0);
  for (let i = 0; i < n; i += 1) {
    store.recipients.push({
      id: `s${String(i).padStart(5, '0')}`,
      campaign: CAMPAIGN,
      phone: `${prefix}${String(1000000 + i)}`,
      name: `Recipient ${i}`,
      status: 'PENDING',
      failReason: null,
      sentAt: null,
      messageId: null,
      createdAt: new Date(base + i * 1000),
    });
  }
}

function terminalError(providerCode?: number, message = 'boom'): WhatsAppError {
  return new WhatsAppError({
    code: 'INVALID_RECIPIENT',
    message,
    retryable: false,
    provider: 'twilio',
    providerCode,
  });
}

beforeEach(() => {
  silentModeSpy.mockClear();
  holdForOutboxSpy.mockClear();
  dispatchSpy.mockClear();
  enqueueSpy.mockClear();
});

// ─── CSV parsing + --load ──────────────────────────────────────────────────

describe('parseCampaignCsv', () => {
  it('parses valid rows, skips the header, rejects non-E.164 with line numbers', () => {
    const csv = [
      'phone,name',
      '+962791234567,أحمد',
      '"+962781234567","Um Khaled, senior"',
      '0791234567,local format', // line 4 — not E.164
      '+962791234567,duplicate of line 2', // line 5 — in-file duplicate
      '',
      '+14155550100,International',
    ].join('\n');
    const { rows, rejected } = parseCampaignCsv(csv);
    expect(rows).toEqual([
      { phone: '+962791234567', name: 'أحمد' },
      { phone: '+962781234567', name: 'Um Khaled, senior' },
      { phone: '+14155550100', name: 'International' },
    ]);
    expect(rejected).toHaveLength(2);
    expect(must(rejected[0]).line).toBe(4);
    expect(must(rejected[1]).line).toBe(5);
    // masked — a full phone never reaches the console
    expect(must(rejected[1]).reason).not.toContain('+962791234567');
  });
});

describe('loadCampaign', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p57-'));

  it('inserts PENDING rows, is idempotent, and never resets a SENT row', async () => {
    const file = join(dir, 'c.csv');
    writeFileSync(file, 'phone,name\n+962791111111,A\n+962792222222,B\n', 'utf8');
    const { deps, store } = makeDeps();

    const first = await loadCampaign(deps, file);
    expect(first).toEqual({ total: 2, inserted: 2, alreadyPresent: 0, rejected: 0 });
    expect(store.recipients.every((r) => r.status === 'PENDING')).toBe(true);

    // Mark one SENT, then re-load: no duplicates, no reset.
    const firstRow = must(store.recipients[0]);
    firstRow.status = 'SENT';
    firstRow.sentAt = INSIDE_WINDOW;
    const second = await loadCampaign(deps, file);
    expect(second).toEqual({ total: 2, inserted: 0, alreadyPresent: 2, rejected: 0 });
    expect(store.recipients).toHaveLength(2);
    expect(must(store.recipients[0]).status).toBe('SENT');

    // Template registration: SID recorded, but the update clause never
    // clobbers twilioApproved (the live sync owns that flag).
    const upsert = must(store.templateUpserts[0]) as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(upsert.create.twilioContentSid).toBe(TEMPLATE_SID);
    expect(upsert.update.twilioContentSid).toBe(TEMPLATE_SID);
    expect('twilioApproved' in upsert.update).toBe(false);

    // Audited.
    expect(
      store.audits.some((a) => (a.after as { event: string }).event === 'BROADCAST_LOAD'),
    ).toBe(true);
  });
});

// ─── Window guard ──────────────────────────────────────────────────────────

describe('send window (Asia/Amman, 10:00 inclusive – 18:00 exclusive)', () => {
  it.each([
    ['09:59 Amman', '2026-08-29T06:59:00Z', false],
    ['10:00 Amman', '2026-08-29T07:00:00Z', true],
    ['17:59 Amman', '2026-08-29T14:59:00Z', true],
    ['18:00 Amman', '2026-08-29T15:00:00Z', false],
  ])('%s → inside=%s', (_label, iso, inside) => {
    expect(isInsideSendWindow(new Date(iso))).toBe(inside);
  });

  it('refuses --apply outside the window: no sends, no canary, audited', async () => {
    const { deps, store, provider } = makeDeps({ now: () => new Date('2026-08-29T06:00:00Z') });
    seedPending(store, 3);
    const summary = await applyRun(deps);
    expect(summary.aborted).toBe('OUTSIDE_WINDOW');
    expect(summary.attempted).toBe(0);
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(store.recipients.every((r) => r.status === 'PENDING')).toBe(true);
    expect(
      store.audits.some((a) => (a.after as { aborted?: string }).aborted === 'OUTSIDE_WINDOW'),
    ).toBe(true);
  });

  it('--ignore-window bypasses the guard with a loud warning', async () => {
    const { deps, store, provider, logs } = makeDeps({
      now: () => new Date('2026-08-29T06:00:00Z'),
    });
    seedPending(store, 2);
    const summary = await applyRun(deps, { ignoreWindow: true });
    expect(summary.sent).toBe(2);
    expect(provider.sendTemplate).toHaveBeenCalledTimes(3); // 2 recipients + canary
    expect(logs.some((l) => l.includes('⚠️') && l.includes('ignore-window'))).toBe(true);
  });
});

// ─── Idempotency, cap, resume ──────────────────────────────────────────────

describe('applyRun — cap + idempotency', () => {
  it('sends in insertion order, marks SENT with a linked message row, caps attempts', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 7);
    const summary = await applyRun(deps, { cap: 5 });

    expect(summary).toMatchObject({ attempted: 5, sent: 5, failed: 0, remainingPending: 2 });
    // 5 recipients + 1 canary
    expect(provider.sendTemplate).toHaveBeenCalledTimes(6);
    // insertion order preserved (CSV order)
    const sentPhones = provider.sendTemplate.mock.calls
      .slice(0, 5)
      .map((c) => (c[0] as { recipientPhone: string }).recipientPhone);
    expect(sentPhones).toEqual(store.recipients.slice(0, 5).map((r) => r.phone));
    // every send: message row with SID, recipient linked + zero variables
    for (const r of store.recipients.slice(0, 5)) {
      expect(r.status).toBe('SENT');
      expect(r.sentAt).not.toBeNull();
      const msg = store.messages.find((m) => m.id === r.messageId);
      expect(msg).toBeDefined();
      expect(msg?.providerMessageId).toMatch(/^SM/);
      expect(msg?.recipientId).toBeNull();
      expect(msg?.appointmentId).toBeNull();
      expect(msg?.direction).toBe('OUTBOUND');
    }
    // pacing between sends (not after the last)
    expect(deps.sleep).toHaveBeenCalledTimes(4);
  });

  it('a SENT row is never selected again; a second run continues with PENDING only', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 4);
    await applyRun(deps, { cap: 2 });
    provider.sendTemplate.mockClear();

    // Same-day re-apply: 2 already sent today count toward the cap of 3 → 1 more.
    const summary = await applyRun(deps, { cap: 3 });
    expect(summary.attempted).toBe(1);
    const recipients = provider.sendTemplate.mock.calls
      .map((c) => (c[0] as { recipientPhone: string }).recipientPhone)
      .filter((p) => p !== CANARY_PHONE);
    expect(recipients).toEqual([must(store.recipients[2]).phone]);
    expect(store.recipients.filter((r) => r.status === 'SENT')).toHaveLength(3);
  });

  it('cap already exhausted today → zero attempts, canary still fires', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 3);
    await applyRun(deps, { cap: 2 });
    provider.sendTemplate.mockClear();

    const summary = await applyRun(deps, { cap: 2 });
    expect(summary.attempted).toBe(0);
    expect(provider.sendTemplate).toHaveBeenCalledTimes(1);
    expect(
      (provider.sendTemplate.mock.calls.at(0)?.[0] as { recipientPhone: string }).recipientPhone,
    ).toBe(CANARY_PHONE);
  });

  // P59 — 150, not 425: the Meta tier is 250 unique conversations/24h and
  // the broadcast must leave headroom for the clinic's own messages.
  it('default cap is 150 (leaves tier headroom for clinic messages)', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, DEFAULT_DAILY_CAP + 5);
    const summary = await applyRun(deps);
    expect(DEFAULT_DAILY_CAP).toBe(150);
    expect(summary.attempted).toBe(DEFAULT_DAILY_CAP);
    expect(provider.sendTemplate).toHaveBeenCalledTimes(DEFAULT_DAILY_CAP + 1); // + canary
    expect(summary.remainingPending).toBe(5);
  });
});

// ─── Guards ────────────────────────────────────────────────────────────────

describe('applyRun — guards', () => {
  it('aborts before any send when the template is not approved (no canary)', async () => {
    const { deps, store, provider } = makeDeps({ isApproved: vi.fn(async () => false) });
    seedPending(store, 3);
    const summary = await applyRun(deps);
    expect(summary.aborted).toBe('TEMPLATE_NOT_APPROVED');
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(store.recipients.every((r) => r.status === 'PENDING')).toBe(true);
  });

  it('aborts when the provider health check fails', async () => {
    const { deps, store, provider } = makeDeps();
    provider.healthCheck.mockResolvedValue(false);
    seedPending(store, 3);
    const summary = await applyRun(deps);
    expect(summary.aborted).toBe('PROVIDER_HEALTH');
    expect(provider.sendTemplate).not.toHaveBeenCalled();
  });
});

// ─── Auto-stop rails ───────────────────────────────────────────────────────

describe('applyRun — auto-stop rails', () => {
  it('63018 aborts immediately and leaves the tripping row PENDING', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 5);
    provider.sendTemplate.mockImplementation(async (args: { recipientPhone: string }) => {
      if (args.recipientPhone === must(store.recipients[2]).phone)
        throw terminalError(63018, 'limit');
      return { providerMessageId: 'SMOK', status: 'SENT' as const };
    });
    const summary = await applyRun(deps);
    expect(summary.aborted).toBe('DAILY_LIMIT_63018');
    expect(summary.sent).toBe(2);
    expect(must(store.recipients[2]).status).toBe('PENDING'); // NOT failed — retries tomorrow
    expect(must(store.recipients[3]).status).toBe('PENDING');
    // canary still fired after the abort
    const last = provider.sendTemplate.mock.calls.at(-1)?.[0] as { recipientPhone: string };
    expect(last.recipientPhone).toBe(CANARY_PHONE);
  });

  it('10 consecutive failures abort the run, remaining rows stay PENDING', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 15);
    provider.sendTemplate.mockImplementation(async (args: { recipientPhone: string }) => {
      if (args.recipientPhone === CANARY_PHONE) {
        return { providerMessageId: 'SMC', status: 'SENT' as const };
      }
      throw terminalError(21211, 'invalid number');
    });
    const summary = await applyRun(deps);
    expect(summary.aborted).toBe('FAILURE_SPIKE_CONSECUTIVE');
    expect(summary.attempted).toBe(10);
    expect(store.recipients.filter((r) => r.status === 'FAILED')).toHaveLength(10);
    expect(store.recipients.filter((r) => r.status === 'PENDING')).toHaveLength(5);
    expect(must(store.recipients[0]).failReason).toContain('invalid number');
  });

  it('>15% failures over the last 100 attempts aborts', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 120);
    let i = 0;
    provider.sendTemplate.mockImplementation(async (args: { recipientPhone: string }) => {
      if (args.recipientPhone === CANARY_PHONE) {
        return { providerMessageId: 'SMC', status: 'SENT' as const };
      }
      i += 1;
      // every 6th send fails → ~17 failures per 100, never 10 consecutive
      if (i % 6 === 1) throw terminalError(21211, 'bad');
      return { providerMessageId: `SM${i}`, status: 'SENT' as const };
    });
    const summary = await applyRun(deps, { cap: 120 });
    expect(summary.aborted).toBe('FAILURE_SPIKE_RATE');
    expect(summary.attempted).toBe(100);
    expect(store.recipients.filter((r) => r.status === 'PENDING').length).toBeGreaterThan(0);
  });
});

// ─── P57b canary ───────────────────────────────────────────────────────────

describe('canary (P57b)', () => {
  it('fires exactly once, after the batch, outside the table and the cap', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 5);
    const summary = await applyRun(deps, { cap: 5 });
    const canaryCalls = provider.sendTemplate.mock.calls.filter(
      (c) => (c[0] as { recipientPhone: string }).recipientPhone === CANARY_PHONE,
    );
    expect(canaryCalls).toHaveLength(1);
    // after the batch — the very last provider call
    expect(
      (provider.sendTemplate.mock.calls.at(-1)?.[0] as { recipientPhone: string }).recipientPhone,
    ).toBe(CANARY_PHONE);
    // outside the recipient table + cap
    expect(store.recipients.some((r) => r.phone === CANARY_PHONE)).toBe(false);
    expect(summary.attempted).toBe(5);
    expect(summary.sent).toBe(5);
    expect(summary.canary).toBe('sent');
    // canary send still gets a WhatsAppMessage row so delivery resolves
    expect(store.messages.some((m) => m.recipientPhone === CANARY_PHONE)).toBe(true);
    // recorded in the run audit
    const runAudit = store.audits.find(
      (a) => (a.after as { event: string }).event === 'BROADCAST_RUN',
    );
    expect((runAudit?.after as { canary: string }).canary).toBe('sent');
  });

  it('a canary failure never fails the run', async () => {
    const { deps, store, provider, logs } = makeDeps();
    seedPending(store, 2);
    provider.sendTemplate.mockImplementation(async (args: { recipientPhone: string }) => {
      if (args.recipientPhone === CANARY_PHONE) throw terminalError(21211, 'canary down');
      return { providerMessageId: 'SMOK', status: 'SENT' as const };
    });
    const summary = await applyRun(deps, { cap: 5 });
    expect(summary.sent).toBe(2);
    expect(summary.canary).toMatch(/^failed: /);
    expect(logs.some((l) => l.includes('canary: failed'))).toBe(true);
  });

  it('dry-run and --report never fire the canary (or any send)', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 3);
    await dryRun(deps, 425);
    await reportRun(deps, mkdtempSync(join(tmpdir(), 'p57r-')));
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    expect(store.recipients.every((r) => r.status === 'PENDING')).toBe(true);
  });
});

// ─── Report ────────────────────────────────────────────────────────────────

describe('reportRun', () => {
  it('aggregates totals, delivery statuses and failure reasons', async () => {
    const { deps, store } = makeDeps();
    seedPending(store, 8);
    // 4 SENT (delivered, read, in-transit, provider-failed-after-accept),
    // 2 FAILED (same reason) + 1 FAILED (other), 1 PENDING.
    const statuses = ['DELIVERED', 'READ', 'SENT', 'FAILED'];
    for (let i = 0; i < 4; i += 1) {
      const row = must(store.recipients[i]);
      store.messages.push({ id: `m${i}`, status: must(statuses[i]), recipientPhone: row.phone });
      Object.assign(row, { status: 'SENT', sentAt: INSIDE_WINDOW, messageId: `m${i}` });
    }
    Object.assign(must(store.recipients[4]), { status: 'FAILED', failReason: 'invalid number' });
    Object.assign(must(store.recipients[5]), { status: 'FAILED', failReason: 'invalid number' });
    Object.assign(must(store.recipients[6]), { status: 'FAILED', failReason: 'opted out' });

    const outDir = mkdtempSync(join(tmpdir(), 'p57r-'));
    const report = await reportRun(deps, outDir);

    expect(report.totals).toEqual({ PENDING: 1, SENT: 4, FAILED: 3, SKIPPED: 0 });
    expect(report.delivery).toEqual({
      delivered: 1,
      read: 1,
      inTransit: 1,
      failedAfterAccept: 1,
    });
    expect(report.failureReasons).toEqual([
      { reason: 'invalid number', count: 2 },
      { reason: 'opted out', count: 1 },
    ]);
    // failed CSV: masked phones only
    const csv = readFileSync(report.failedCsvPath as string, 'utf8');
    expect(csv).toContain('invalid number');
    expect(csv).not.toContain(must(store.recipients[4]).phone);
    expect(csv).toContain(must(store.recipients[4]).phone.slice(-3));
  });
});

// ─── Exemptions + pins ─────────────────────────────────────────────────────

describe('silent-mode / dispatch exemption (P51 §7)', () => {
  it('sends even with silent mode ON — the gate is never consulted', async () => {
    const { deps, store, provider } = makeDeps();
    seedPending(store, 3);
    const summary = await applyRun(deps);
    expect(summary.sent).toBe(3);
    expect(provider.sendTemplate).toHaveBeenCalledTimes(4);
    expect(silentModeSpy).not.toHaveBeenCalled();
    expect(holdForOutboxSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('the script imports neither the dispatch layer, silent mode, nor the queue', () => {
    const source = readFileSync(join(__dirname, '..', 'broadcast-number-change.ts'), 'utf8');
    expect(source).not.toMatch(/from '@\/lib\/whatsapp\/silent-mode'/);
    expect(source).not.toMatch(/from '@\/lib\/whatsapp\/dispatch/);
    expect(source).not.toMatch(/from '@\/lib\/queue/);
  });
});

describe('conversation-bump skip (approved deviation)', () => {
  it('a broadcast run creates and updates no WhatsAppConversation', async () => {
    const { deps, store } = makeDeps();
    seedPending(store, 4);
    await applyRun(deps);
    expect(store.conversationCalls).toBe(0);
  });

  it('an inbound reply after a broadcast shows the broadcast message in the thread', async () => {
    // The inbox thread view keys messages by phone alone — a broadcast row
    // (recipientId null, appointmentId null, no conversation bump at send
    // time) appears once the reply has created the conversation.
    const { db } = await import('@/lib/db');
    const mocked = db as unknown as Record<string, unknown>;
    const phone = '+962791234567';
    mocked.whatsAppConversation = {
      findUnique: vi.fn(async () => ({
        id: 'conv1',
        phone,
        patientId: null,
        patient: null,
        lastInboundAt: new Date(),
        lastMessageAt: new Date(),
      })),
    };
    mocked.user = { findMany: vi.fn(async () => []) };
    const messageFindMany = vi.fn(async (args: { where: { recipientPhone: string } }) => {
      expect(args.where).toEqual({ recipientPhone: phone }); // phone-only filter — the pin
      return [
        {
          id: 'mb1',
          direction: 'OUTBOUND',
          body: 'إشعار تغيير الأرقام',
          sentAt: new Date('2026-08-29T08:00:00Z'),
          status: 'DELIVERED',
          deliveredAt: new Date(),
          readAt: null,
          templateId: 'tpl1',
          parameters: {},
          intent: null,
          template: { name: TEMPLATE_NAME, contentPreview: 'إشعار تغيير الأرقام' },
          sentBy: null,
          attachments: [],
        },
        {
          id: 'mi1',
          direction: 'INBOUND',
          body: 'شو الأرقام الجديدة؟',
          sentAt: new Date('2026-08-29T09:00:00Z'),
          status: 'DELIVERED',
          deliveredAt: null,
          readAt: null,
          templateId: null,
          parameters: {},
          intent: null,
          template: null,
          sentBy: null,
          attachments: [],
        },
      ];
    });
    mocked.whatsAppMessage = { findMany: messageFindMany };

    const { getThread } = await import('@/lib/whatsapp/inbox/queries');
    const thread = await getThread('conv1');
    expect(thread).not.toBeNull();
    expect(thread?.messages.map((m) => m.id)).toEqual(['mb1', 'mi1']);
    expect(thread?.messages[0]?.isTemplate).toBe(true);
  });
});

// ─── Small helpers ─────────────────────────────────────────────────────────

describe('helpers', () => {
  it('maskPhone keeps only the last 3 digits', () => {
    expect(maskPhone('+962787075008')).toBe('**********008');
    expect(maskPhone('+12')).toBe('+12');
  });

  it('isDailyLimitError matches 63018 (number or string), nothing else', () => {
    expect(isDailyLimitError(terminalError(63018))).toBe(true);
    expect(
      isDailyLimitError(
        new WhatsAppError({
          code: 'INVALID_RECIPIENT',
          message: 'x',
          retryable: false,
          provider: 'twilio',
          providerCode: '63018',
        }),
      ),
    ).toBe(true);
    expect(isDailyLimitError(terminalError(21211))).toBe(false);
    expect(isDailyLimitError(new Error('63018'))).toBe(false);
  });
});
