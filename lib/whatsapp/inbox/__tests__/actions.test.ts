import { describe, expect, it, vi } from 'vitest';

/**
 * Prompt 49 — inbox mutations: RBAC at the data layer, HARD 24h window
 * enforcement on send, and link-to-patient riding the audited updatePatient
 * service (never a raw phone write).
 */

const sessionState: { user: { id: string; role: string } | null } = { user: null };
vi.mock('@/lib/impersonation/session', () => ({
  getEffectiveSession: vi.fn(async () =>
    sessionState.user ? { user: sessionState.user, isImpersonating: false } : null,
  ),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/db', () => {
  const state = {
    conversations: [] as Array<{
      id: string;
      phone: string;
      patientId: string | null;
      lastInboundAt: Date | null;
      lastReadAt: Date | null;
      lastHumanReplyAt: Date | null;
      lastMessageAt: Date;
    }>,
    users: [] as Array<Record<string, unknown>>,
    conversationUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    auditLogs: [] as Array<Record<string, unknown>>,
  };
  return {
    __state: state,
    db: {
      whatsAppConversation: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.conversations.find((c) => c.id === where.id) ?? null,
        ),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            state.conversationUpdates.push({ id: where.id, data });
            const row = state.conversations.find((c) => c.id === where.id);
            if (row) Object.assign(row, data);
            return row;
          },
        ),
      },
      user: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.users.find((u) => u.id === where.id) ?? null,
        ),
        findFirst: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            state.users.find((u) => u.id === where.id && u.role === 'PATIENT') ?? null,
        ),
      },
      auditLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.auditLogs.push(data);
          return data;
        }),
      },
    },
  };
});

const enqueued: Array<Record<string, unknown>> = [];
vi.mock('@/lib/queue/jobs/whatsappOutbound', () => ({
  enqueueWhatsappOutbound: vi.fn(async (job: Record<string, unknown>) => {
    enqueued.push(job);
    return 'job-1';
  }),
}));

const updatePatientCalls: Array<Record<string, unknown>> = [];
let updatePatientFails: { error: { code: string; message_en: string; message_ar: string } } | null =
  null;
vi.mock('@/lib/patients/services', () => ({
  updatePatient: vi.fn(async (input: Record<string, unknown>) => {
    if (updatePatientFails) throw updatePatientFails;
    updatePatientCalls.push(input);
    return { id: input.id };
  }),
}));

import {
  linkConversationToPatientAction,
  markConversationReadAction,
  sendInboxReplyAction,
} from '../actions';
import * as dbModule from '@/lib/db';

type State = {
  conversations: Array<{
    id: string;
    phone: string;
    patientId: string | null;
    lastInboundAt: Date | null;
    lastReadAt: Date | null;
    lastHumanReplyAt: Date | null;
    lastMessageAt: Date;
  }>;
  users: Array<Record<string, unknown>>;
  conversationUpdates: Array<{ id: string; data: Record<string, unknown> }>;
  auditLogs: Array<Record<string, unknown>>;
};
const state = (dbModule as unknown as { __state: State }).__state;

function reset(): void {
  state.conversations.length = 0;
  state.users.length = 0;
  state.conversationUpdates.length = 0;
  state.auditLogs.length = 0;
  enqueued.length = 0;
  updatePatientCalls.length = 0;
  updatePatientFails = null;
  sessionState.user = { id: 'sec-1', role: 'SECRETARY' };
}

function seedConversation(over: Partial<State['conversations'][number]> = {}): void {
  state.conversations.push({
    id: 'c1',
    phone: '+962790000001',
    patientId: 'p1',
    lastInboundAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago → window open
    lastReadAt: null,
    lastHumanReplyAt: null,
    lastMessageAt: new Date(Date.now() - 60 * 60 * 1000),
    ...over,
  });
}

describe('RBAC — every inbox action denies DOCTOR / THERAPIST / PATIENT / anonymous', () => {
  it.each(['DOCTOR', 'THERAPIST', 'PATIENT'])('%s is denied on all three actions', async (role) => {
    reset();
    seedConversation();
    sessionState.user = { id: 'u-x', role };
    const results = await Promise.all([
      markConversationReadAction('c1'),
      sendInboxReplyAction({ conversationId: 'c1', body: 'hi' }),
      linkConversationToPatientAction({ conversationId: 'c1', patientId: 'p1' }),
    ]);
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    }
    expect(enqueued).toHaveLength(0);
    expect(state.conversationUpdates).toHaveLength(0);
  });

  it('no session at all is denied', async () => {
    reset();
    seedConversation();
    sessionState.user = null;
    const r = await sendInboxReplyAction({ conversationId: 'c1', body: 'hi' });
    expect(r.ok).toBe(false);
  });

  it('ADMIN is allowed (shares the inbox with SECRETARY)', async () => {
    reset();
    seedConversation();
    sessionState.user = { id: 'adm-1', role: 'ADMIN' };
    const r = await markConversationReadAction('c1');
    expect(r.ok).toBe(true);
  });
});

describe('markConversationReadAction — shared read state', () => {
  it('stamps lastReadAt (clears the badge for EVERYONE)', async () => {
    reset();
    seedConversation();
    const r = await markConversationReadAction('c1');
    expect(r.ok).toBe(true);
    expect(state.conversationUpdates[0]!.data.lastReadAt).toBeInstanceOf(Date);
  });
});

describe('sendInboxReplyAction — 24h window is enforced SERVER-side', () => {
  it('inside the window: enqueues a text with source=inbox + sentById and stamps suppression', async () => {
    reset();
    seedConversation({
      lastInboundAt: new Date(Date.now() - (24 * 60 - 1) * 60 * 1000), // T+23:59
    });
    state.users.push({ id: 'p1', languagePref: 'AR' });
    const r = await sendInboxReplyAction({ conversationId: 'c1', body: 'أهلاً، كيف نساعدك؟' });
    expect(r.ok).toBe(true);
    expect(enqueued[0]).toMatchObject({
      kind: 'text',
      recipientPhone: '+962790000001',
      source: 'inbox',
      sentById: 'sec-1',
      language: 'AR',
    });
    // Human reply owns the thread: suppression + read + ordering stamps.
    const stamped = state.conversationUpdates.at(-1)!.data;
    expect(stamped.lastHumanReplyAt).toBeInstanceOf(Date);
    expect(stamped.lastReadAt).toBeInstanceOf(Date);
    expect(stamped.lastMessageAt).toBeInstanceOf(Date);
    // Audited (INBOX_REPLY_SENT event).
    expect(state.auditLogs.at(-1)).toMatchObject({
      entityType: 'WhatsAppConversation',
      after: { event: 'INBOX_REPLY_SENT' },
    });
  });

  it('outside the window (T+24:01): rejected with the localized explanation, nothing enqueued', async () => {
    reset();
    seedConversation({
      lastInboundAt: new Date(Date.now() - (24 * 60 + 1) * 60 * 1000),
    });
    const r = await sendInboxReplyAction({ conversationId: 'c1', body: 'مرحبا' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('WA_WINDOW_CLOSED');
      expect(r.error.message_ar).toContain('انتهت نافذة الرد الحر');
    }
    expect(enqueued).toHaveLength(0);
  });

  it('a conversation that never had an inbound: blocked (no window ever opened)', async () => {
    reset();
    seedConversation({ lastInboundAt: null });
    const r = await sendInboxReplyAction({ conversationId: 'c1', body: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('WA_WINDOW_CLOSED');
  });

  it('validation: empty / oversized body rejected', async () => {
    reset();
    seedConversation();
    expect((await sendInboxReplyAction({ conversationId: 'c1', body: '   ' })).ok).toBe(false);
    expect((await sendInboxReplyAction({ conversationId: 'c1', body: 'x'.repeat(2001) })).ok).toBe(
      false,
    );
    expect(enqueued).toHaveLength(0);
  });
});

describe('linkConversationToPatientAction — rides the audited updatePatient service', () => {
  function seedPatient(): void {
    state.users.push({
      id: 'p9',
      role: 'PATIENT',
      deletedAt: null,
      fullNameEn: 'Omar Nabil',
      fullNameAr: 'عمر نبيل',
      email: 'omar@example.com',
      phone: '+962790000009',
      languagePref: 'AR',
      patientProfile: {
        dateOfBirth: new Date('1990-01-01'),
        gender: 'MALE',
        nationalId: null,
        address: null,
        occupation: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        medicalHistorySummary: null,
        allergies: null,
        currentMedications: null,
        hijriCalendarPref: false,
      },
    });
  }

  it('passes the CONVERSATION phone into updatePatient (audit + normalization + uniqueness live there) then links', async () => {
    reset();
    seedConversation({ id: 'c-unk', phone: '+962795555555', patientId: null });
    seedPatient();
    const r = await linkConversationToPatientAction({ conversationId: 'c-unk', patientId: 'p9' });
    expect(r.ok).toBe(true);
    expect(updatePatientCalls[0]).toMatchObject({ id: 'p9', phone: '+962795555555' });
    const link = state.conversationUpdates.find((u) => u.id === 'c-unk');
    expect(link!.data).toMatchObject({ patientId: 'p9' });
  });

  it('phone-uniqueness collision from updatePatient surfaces VERBATIM and the link is NOT made', async () => {
    reset();
    seedConversation({ id: 'c-unk', phone: '+962795555555', patientId: null });
    seedPatient();
    updatePatientFails = {
      error: {
        code: 'PHONE_TAKEN',
        message_en: 'Phone number already in use.',
        message_ar: 'رقم الهاتف مستخدم بالفعل.',
      },
    };
    const r = await linkConversationToPatientAction({ conversationId: 'c-unk', patientId: 'p9' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('PHONE_TAKEN');
    expect(state.conversationUpdates).toHaveLength(0);
  });

  it('unknown conversation / patient → NOT_FOUND', async () => {
    reset();
    seedPatient();
    expect(
      (await linkConversationToPatientAction({ conversationId: 'nope', patientId: 'p9' })).ok,
    ).toBe(false);
    seedConversation({ id: 'c-unk', patientId: null });
    expect(
      (await linkConversationToPatientAction({ conversationId: 'c-unk', patientId: 'ghost' })).ok,
    ).toBe(false);
  });
});
