import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P62 — a staff-bound internal alert (recipient user role ≠ PATIENT) shares
 * the outbound queue but must skip the two PATIENT-only side effects:
 *
 *   1. the Prompt 49 Inbox conversation bump (a clinician's number must not
 *      become a "patient" thread pinned to the top of the secretary's Inbox);
 *   2. the OUTBOUND_DELIVERY_FAILED triage item on terminal failure (its
 *      Inbox row links to /secretary/patients/{id} — dead for a staff row).
 *
 * The message row, the provider call, and the reachability flag behave as
 * for any recipient. A PATIENT recipient keeps today's behaviour exactly.
 */

type Processor = (job: {
  id: string;
  data: Record<string, unknown>;
  attemptsMade: number;
  opts: { attempts: number };
}) => Promise<unknown>;

let processor: Processor | null = null;
vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_queue: string, fn: Processor) {
      processor = fn;
    }
    on(): void {}
  },
  Queue: class {
    on(): void {}
  },
}));

vi.mock('@/lib/queue/client', () => ({ queueRedis: {} }));

const state = {
  user: null as { id: string; role?: string } | null,
  sendFails: false,
};

// Typed with one argument so `mock.calls[0]![0]` is addressable under strict TS.
const { conversationUpsert, inboxCreate, messageCreate, userUpdate } = vi.hoisted(() => ({
  conversationUpsert: vi.fn(async (_args: unknown) => ({})),
  inboxCreate: vi.fn(async (_args: unknown) => ({})),
  messageCreate: vi.fn(async (_args: unknown) => ({ id: 'msg-1' })),
  userUpdate: vi.fn(async (_args: unknown) => ({})),
}));

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findFirst: vi.fn(async () => state.user),
      update: userUpdate,
    },
    appointment: { findUnique: vi.fn(async () => ({ id: 'appt-1' })) },
    whatsAppTemplate: { findUnique: vi.fn(async () => null) },
    whatsAppMessage: { create: messageCreate },
    whatsAppConversation: { upsert: conversationUpsert },
    inboxItem: { create: inboxCreate },
  },
}));

vi.mock('@/lib/whatsapp', async () => {
  const { WhatsAppError } = await import('@/lib/whatsapp/errors');
  return {
    whatsapp: {
      sendTemplate: vi.fn(async () => {
        if (state.sendFails) {
          // A recipient-side, non-retryable failure (not on WhatsApp).
          throw new WhatsAppError({
            code: 'INVALID_RECIPIENT',
            message: 'not a WhatsApp user',
            retryable: false,
            provider: 'twilio',
            providerCode: 63024,
          });
        }
        return { status: 'SENT', providerMessageId: 'prov-1' };
      }),
      sendText: vi.fn(async () => ({ status: 'SENT', providerMessageId: 'prov-2' })),
    },
  };
});

vi.mock('@/lib/whatsapp/rateLimit', () => ({
  makeOutboundRateLimiter: () => ({ acquire: vi.fn(async () => ({ allowed: true })) }),
}));

import { startWhatsappOutboundWorker } from '../whatsapp';

function job(data: Record<string, unknown>) {
  return { id: 'job-1', data, attemptsMade: 0, opts: { attempts: 3 } };
}

const alertJob = {
  kind: 'template',
  templateName: 'clinic_custom_message',
  language: 'AR',
  parameters: ['رنا', 'وصل المريض Sara Khalil لموعده الساعة 10:00.'],
  recipientPhone: '+962779639133',
  recipientUserId: 'u-1',
  appointmentId: 'appt-1',
  source: 'queue',
};

beforeEach(() => {
  processor = null;
  startWhatsappOutboundWorker();
  state.user = null;
  state.sendFails = false;
  conversationUpsert.mockClear();
  inboxCreate.mockClear();
  messageCreate.mockClear();
  userUpdate.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('P62 — staff recipient on the outbound worker', () => {
  it('THERAPIST recipient: sent + message row + reachable=true, but NO conversation bump', async () => {
    state.user = { id: 'u-1', role: 'THERAPIST' };
    const result = await processor!(job(alertJob));
    expect(result).toMatchObject({ ok: true });
    expect(messageCreate).toHaveBeenCalledTimes(1);
    expect(messageCreate.mock.calls[0]![0]).toMatchObject({
      data: { recipientId: 'u-1', status: 'SENT', source: 'QUEUE' },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { whatsappReachable: true },
    });
    expect(conversationUpsert).not.toHaveBeenCalled();
  });

  it('DOCTOR recipient is staff too — no conversation thread', async () => {
    state.user = { id: 'u-1', role: 'DOCTOR' };
    await processor!(job(alertJob));
    expect(conversationUpsert).not.toHaveBeenCalled();
  });

  it('PATIENT recipient keeps the Prompt 49 conversation bump', async () => {
    state.user = { id: 'u-1', role: 'PATIENT' };
    await processor!(job(alertJob));
    expect(conversationUpsert).toHaveBeenCalledTimes(1);
    expect(conversationUpsert.mock.calls[0]![0]).toMatchObject({
      where: { phone: '+962779639133' },
      create: { phone: '+962779639133', patientId: 'u-1' },
    });
  });

  it('a recipient lookup without a role (legacy mocks / no user) keeps the patient behaviour', async () => {
    state.user = { id: 'u-1' };
    await processor!(job(alertJob));
    expect(conversationUpsert).toHaveBeenCalledTimes(1);
  });

  it('terminal failure for a THERAPIST: FAILED row + flag flipped, but NO patient-triage inbox item', async () => {
    state.user = { id: 'u-1', role: 'THERAPIST' };
    state.sendFails = true;
    await processor!(job(alertJob)).catch(() => undefined);
    expect(messageCreate).toHaveBeenCalledTimes(1);
    expect(messageCreate.mock.calls[0]![0]).toMatchObject({ data: { status: 'FAILED' } });
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate.mock.calls[0]![0]).toMatchObject({
      where: { id: 'u-1' },
      data: { whatsappReachable: false },
    });
    expect(inboxCreate).not.toHaveBeenCalled();
    expect(conversationUpsert).not.toHaveBeenCalled();
  });

  it('terminal failure for a PATIENT still files the OUTBOUND_DELIVERY_FAILED item', async () => {
    state.user = { id: 'u-1', role: 'PATIENT' };
    state.sendFails = true;
    await processor!(job(alertJob)).catch(() => undefined);
    expect(inboxCreate).toHaveBeenCalledTimes(1);
    expect(inboxCreate.mock.calls[0]![0]).toMatchObject({
      data: { type: 'OUTBOUND_DELIVERY_FAILED', patientId: 'u-1', messageId: 'msg-1' },
    });
  });
});
