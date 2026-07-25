import { describe, expect, it, vi } from 'vitest';

// In-memory DB stub — same style as the 48b process harness.
vi.mock('@/lib/db', () => {
  const state = {
    conversations: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
    appointments: [] as Array<Record<string, unknown>>,
    users: [] as Array<Record<string, unknown>>,
  };
  return {
    __state: state,
    db: {
      user: {
        // P50 — getThread's "all patients on this phone" lookup.
        findMany: vi.fn(async ({ where }: { where: { phone: string } }) =>
          state.users.filter((u) => u.phone === where.phone && u.role === 'PATIENT'),
        ),
      },
      whatsAppConversation: {
        findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
          let rows = [...state.conversations];
          if (where && 'lastInboundAt' in where) {
            rows = rows.filter((c) => c.lastInboundAt !== null);
          }
          return rows.sort(
            (a, b) => (b.lastMessageAt as Date).getTime() - (a.lastMessageAt as Date).getTime(),
          );
        }),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.conversations.find((c) => c.id === where.id) ?? null,
        ),
      },
      whatsAppMessage: {
        findMany: vi.fn(async (query: Record<string, unknown>) => {
          const where = query.where as { recipientPhone: string | { in: string[] } };
          const orderBy = query.orderBy as { sentAt?: 'asc' | 'desc' } | undefined;
          const phones =
            typeof where.recipientPhone === 'string'
              ? [where.recipientPhone]
              : where.recipientPhone.in;
          const rows = state.messages.filter((m) => phones.includes(m.recipientPhone as string));
          const dir = orderBy?.sentAt === 'asc' ? 1 : -1;
          return rows.sort(
            (a, b) => dir * ((a.sentAt as Date).getTime() - (b.sentAt as Date).getTime()),
          );
        }),
      },
      appointment: {
        findFirst: vi.fn(async () => state.appointments[0] ?? null),
      },
    },
  };
});

import {
  SESSION_WINDOW_MS,
  canAccessInbox,
  canSendFreeText,
  countUnreadConversations,
  getThread,
  isUnread,
  listConversations,
  windowClosesAt,
} from '../queries';
import * as dbModule from '@/lib/db';

type State = {
  conversations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  appointments: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
};
const state = (dbModule as unknown as { __state: State }).__state;

function reset(): void {
  state.conversations.length = 0;
  state.messages.length = 0;
  state.appointments.length = 0;
  state.users.length = 0;
}

function conv(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c1',
    phone: '+962790000001',
    patientId: 'p1',
    patient: { fullNameEn: 'Sara Khalil', fullNameAr: 'سارة خليل' },
    lastInboundAt: new Date('2026-07-20T10:00:00Z'),
    lastMessageAt: new Date('2026-07-20T10:00:00Z'),
    lastReadAt: null,
    lastHumanReplyAt: null,
    ...over,
  };
}

describe('canAccessInbox — SECRETARY + ADMIN only (§1.1)', () => {
  it.each([
    ['SECRETARY', true],
    ['ADMIN', true],
    ['DOCTOR', false],
    ['THERAPIST', false],
    ['PATIENT', false],
  ] as const)('%s → %s', (role, allowed) => {
    expect(canAccessInbox(role)).toBe(allowed);
  });
});

describe('24h free-text window math (TZ-agnostic — pure UTC epoch)', () => {
  const t0 = new Date('2026-07-20T10:00:00Z');

  it('never opened (no inbound) → closed', () => {
    expect(windowClosesAt(null)).toBeNull();
    expect(canSendFreeText(null)).toBe(false);
  });

  it('closes exactly 24h after the last inbound', () => {
    expect(windowClosesAt(t0)!.getTime()).toBe(t0.getTime() + SESSION_WINDOW_MS);
  });

  it('T+23:59 → allowed', () => {
    const now = new Date(t0.getTime() + 24 * 60 * 60 * 1000 - 60 * 1000);
    expect(canSendFreeText(t0, now)).toBe(true);
  });

  it('T+24:01 → blocked', () => {
    const now = new Date(t0.getTime() + 24 * 60 * 60 * 1000 + 60 * 1000);
    expect(canSendFreeText(t0, now)).toBe(false);
  });

  it('T+24:00 exactly → blocked (boundary is exclusive)', () => {
    const now = new Date(t0.getTime() + SESSION_WINDOW_MS);
    expect(canSendFreeText(t0, now)).toBe(false);
  });
});

describe('isUnread — shared read state (§1.3)', () => {
  const inbound = new Date('2026-07-20T10:00:00Z');

  it('inbound after last read → unread', () => {
    expect(isUnread({ lastInboundAt: inbound, lastReadAt: new Date('2026-07-20T09:00:00Z') })).toBe(
      true,
    );
  });

  it('never read but has inbound → unread', () => {
    expect(isUnread({ lastInboundAt: inbound, lastReadAt: null })).toBe(true);
  });

  it('read after last inbound → read (ANY secretary/admin opening clears for everyone)', () => {
    expect(isUnread({ lastInboundAt: inbound, lastReadAt: new Date('2026-07-20T10:01:00Z') })).toBe(
      false,
    );
  });

  it('outbound-only conversation (no inbound ever) → never unread', () => {
    expect(isUnread({ lastInboundAt: null, lastReadAt: null })).toBe(false);
  });
});

describe('listConversations', () => {
  it('sorts by lastMessageAt desc and filters unknown/unread', async () => {
    reset();
    state.conversations.push(
      conv({ id: 'c1', lastMessageAt: new Date('2026-07-20T10:00:00Z') }),
      conv({
        id: 'c2',
        phone: '+962790000002',
        patientId: null,
        patient: null,
        lastMessageAt: new Date('2026-07-20T12:00:00Z'),
        lastReadAt: new Date('2026-07-21T00:00:00Z'),
      }),
    );
    const all = await listConversations('all');
    expect(all.map((c) => c.id)).toEqual(['c2', 'c1']);

    const unknown = await listConversations('unknown');
    expect(unknown.map((c) => c.id)).toEqual(['c2']);

    // c2 was read after its inbound; only c1 is unread.
    const unread = await listConversations('unread');
    expect(unread.map((c) => c.id)).toEqual(['c1']);
  });

  it('search matches name and phone', async () => {
    reset();
    state.conversations.push(
      conv({ id: 'c1' }),
      conv({
        id: 'c2',
        phone: '+962790000002',
        patientId: 'p2',
        patient: { fullNameEn: 'Omar Nabil', fullNameAr: 'عمر نبيل' },
        lastMessageAt: new Date('2026-07-20T12:00:00Z'),
      }),
    );
    expect((await listConversations('all', 'sara')).map((c) => c.id)).toEqual(['c1']);
    expect((await listConversations('all', 'عمر')).map((c) => c.id)).toEqual(['c2']);
    expect((await listConversations('all', '0000002')).map((c) => c.id)).toEqual(['c2']);
  });

  it('surfaces the REAL stored status of the last outbound (SENT stays SENT — honesty rule)', async () => {
    reset();
    state.conversations.push(conv());
    state.messages.push(
      {
        recipientPhone: '+962790000001',
        body: 'hello from clinic',
        direction: 'OUTBOUND',
        status: 'SENT',
        sentAt: new Date('2026-07-20T11:00:00Z'),
      },
      {
        recipientPhone: '+962790000001',
        body: 'مرحبا',
        direction: 'INBOUND',
        status: 'DELIVERED',
        sentAt: new Date('2026-07-20T10:00:00Z'),
      },
    );
    const [row] = await listConversations('all');
    expect(row!.lastOutboundStatus).toBe('SENT');
    expect(row!.lastSnippet).toBe('hello from clinic');
    expect(row!.lastDirection).toBe('OUTBOUND');
  });
});

describe('getThread — derivation from WhatsAppMessage by phone', () => {
  it('returns chronological messages with template flag and button payload', async () => {
    reset();
    state.conversations.push(conv());
    state.messages.push(
      {
        id: 'm1',
        recipientPhone: '+962790000001',
        direction: 'OUTBOUND',
        body: 'reminder text',
        sentAt: new Date('2026-07-20T09:00:00Z'),
        status: 'DELIVERED',
        deliveredAt: new Date('2026-07-20T09:00:05Z'),
        readAt: null,
        templateId: 'tpl-1',
        parameters: {},
        intent: null,
        sentBy: null,
      },
      {
        id: 'm2',
        recipientPhone: '+962790000001',
        direction: 'INBOUND',
        body: 'تأكيد الحضور',
        sentAt: new Date('2026-07-20T10:00:00Z'),
        status: 'DELIVERED',
        deliveredAt: null,
        readAt: null,
        templateId: null,
        parameters: { buttonPayload: 'confirm' },
        intent: 'CONFIRM',
        sentBy: null,
      },
      {
        id: 'm3',
        recipientPhone: '+962790000001',
        direction: 'OUTBOUND',
        body: 'رد يدوي',
        sentAt: new Date('2026-07-20T10:05:00Z'),
        status: 'SENT',
        deliveredAt: null,
        readAt: null,
        templateId: null,
        parameters: {},
        intent: null,
        sentBy: { fullNameEn: 'Reception' },
      },
    );
    const thread = await getThread('c1');
    expect(thread).not.toBeNull();
    expect(thread!.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(thread!.messages[0]).toMatchObject({ isTemplate: true, buttonPayload: null });
    expect(thread!.messages[1]).toMatchObject({ isTemplate: false, buttonPayload: 'confirm' });
    expect(thread!.messages[2]).toMatchObject({ sentByName: 'Reception', status: 'SENT' });
    expect(thread!.conversation.windowClosesAt!.getTime()).toBe(
      new Date('2026-07-20T10:00:00Z').getTime() + SESSION_WINDOW_MS,
    );
  });

  it('unknown conversation id → null', async () => {
    reset();
    expect(await getThread('nope')).toBeNull();
  });

  it('P50: a shared family number lists EVERY patient on it in the thread header', async () => {
    reset();
    state.conversations.push(conv());
    state.users.push(
      { id: 'p1', phone: '+962790000001', role: 'PATIENT', fullNameEn: '', fullNameAr: 'ليان' },
      { id: 'p2', phone: '+962790000001', role: 'PATIENT', fullNameEn: '', fullNameAr: 'قيس' },
      { id: 'other', phone: '+962790000009', role: 'PATIENT', fullNameEn: 'X', fullNameAr: '' },
    );
    const thread = await getThread('c1');
    expect(thread!.patients.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('countUnreadConversations — the sidebar badge counts CONVERSATIONS', () => {
  it('two unread threads with many unread messages each still count 2', async () => {
    reset();
    state.conversations.push(
      conv({ id: 'c1' }),
      conv({ id: 'c2', phone: '+962790000002', lastMessageAt: new Date('2026-07-20T12:00:00Z') }),
      conv({
        id: 'c3',
        phone: '+962790000003',
        lastReadAt: new Date('2026-07-21T00:00:00Z'),
        lastMessageAt: new Date('2026-07-19T12:00:00Z'),
      }),
    );
    expect(await countUnreadConversations()).toBe(2);
  });
});
