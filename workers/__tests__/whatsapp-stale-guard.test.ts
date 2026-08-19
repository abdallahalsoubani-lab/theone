import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P50 (revised) Phase C-3 — the outbound job payload embeds the phone number
 * and the rendered parameters, so a job can outlive the DB rows it was built
 * from. Two guarantees:
 *
 *   1. A job whose recipient user or appointment no longer exists sends
 *      NOTHING and completes cleanly (no retry churn).
 *   2. A persistence failure AFTER a successful provider send never rethrows
 *      — a retry would call the provider again and the patient would receive
 *      the same message two or three times (the observed triple-send hazard).
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
  user: null as { id: string } | null,
  appointment: null as { id: string } | null,
  persistThrows: false,
  sent: [] as string[],
  persisted: 0,
};

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findFirst: vi.fn(async () => state.user),
      update: vi.fn(async () => ({})),
    },
    appointment: { findUnique: vi.fn(async () => state.appointment) },
    whatsAppTemplate: { findUnique: vi.fn(async () => null) },
    whatsAppMessage: {
      create: vi.fn(async () => {
        if (state.persistThrows) throw new Error('FK violation: recipient row is gone');
        state.persisted += 1;
        return { id: 'msg-1' };
      }),
    },
    whatsAppConversation: { upsert: vi.fn(async () => ({})) },
    inboxItem: { create: vi.fn(async () => ({})) },
  },
}));

vi.mock('@/lib/whatsapp', () => ({
  whatsapp: {
    sendTemplate: vi.fn(async () => {
      state.sent.push('template');
      return { status: 'SENT', providerMessageId: 'prov-1' };
    }),
    sendText: vi.fn(async () => {
      state.sent.push('text');
      return { status: 'SENT', providerMessageId: 'prov-2' };
    }),
  },
}));

vi.mock('@/lib/whatsapp/rateLimit', () => ({
  makeOutboundRateLimiter: () => ({ acquire: vi.fn(async () => ({ allowed: true })) }),
}));

import { startWhatsappOutboundWorker } from '../whatsapp';

function job(data: Record<string, unknown>) {
  return { id: 'job-1', data, attemptsMade: 0, opts: { attempts: 3 } };
}

const templateJob = {
  kind: 'template',
  templateName: 'appointment_reminder_v2',
  language: 'AR',
  parameters: ['x'],
  recipientPhone: '+962790000000',
  recipientUserId: 'patient-1',
  appointmentId: 'appt-1',
};

describe('whatsapp outbound worker — stale-payload guard (P50 C-3)', () => {
  beforeEach(() => {
    state.user = { id: 'patient-1' };
    state.appointment = { id: 'appt-1' };
    state.persistThrows = false;
    state.sent = [];
    state.persisted = 0;
    startWhatsappOutboundWorker();
  });

  it('skips the send entirely when the recipient user is gone', async () => {
    state.user = null;
    const result = await processor!(job(templateJob));
    expect(result).toMatchObject({ ok: false, skipped: 'RECIPIENT_MISSING' });
    expect(state.sent).toHaveLength(0);
  });

  it('skips the send entirely when the appointment is gone', async () => {
    state.appointment = null;
    const result = await processor!(job(templateJob));
    expect(result).toMatchObject({ ok: false, skipped: 'APPOINTMENT_MISSING' });
    expect(state.sent).toHaveLength(0);
  });

  it('sends normally when both referenced rows exist', async () => {
    const result = await processor!(job(templateJob));
    expect(result).toMatchObject({ ok: true });
    expect(state.sent).toEqual(['template']);
    expect(state.persisted).toBe(1);
  });

  it('NEVER rethrows after a successful send when persistence fails (no double-send)', async () => {
    state.persistThrows = true;
    const result = await processor!(job(templateJob));
    // Completes despite the FK failure — a rethrow would re-run the provider.
    expect(result).toMatchObject({ ok: true });
    expect(state.sent).toEqual(['template']);
  });
});
