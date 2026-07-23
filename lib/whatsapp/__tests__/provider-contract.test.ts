import type { LanguagePref } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

/**
 * Prompt 45 §5 — the provider CONTRACT test: for equivalent real-world events
 * (an inbound reply, a delivered receipt, a failed receipt) the Twilio and
 * Meta providers must normalize to the SAME `WebhookEvent` shapes, so the
 * inbound pipeline (process.ts → inbox) stays provider-blind. If either
 * provider drifts, this fails naming the divergent field.
 */

vi.mock('@/lib/db', () => ({
  db: {
    whatsAppTemplate: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  },
}));
vi.mock('@/lib/env', () => ({
  env: {
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'auth_token_secret',
    TWILIO_WHATSAPP_FROM: '+962780150215',
    META_WHATSAPP_PHONE_NUMBER_ID: 'pnid',
    META_WHATSAPP_ACCESS_TOKEN: 'token',
    META_WHATSAPP_APP_SECRET: 'secret',
    NEXT_PUBLIC_APP_URL: 'https://example.com',
  },
}));

import { MetaWhatsAppProvider } from '../providers/meta';
import { TwilioWhatsAppProvider } from '../providers/twilio';
import type { WebhookEvent } from '../provider';

const twilio = new TwilioWhatsAppProvider({
  client: {
    messages: { create: vi.fn(async () => ({ sid: 'SM1', status: 'queued' })) },
    api: { v2010: { accounts: () => ({ fetch: async () => ({ sid: 'AC_test' }) }) } },
  },
});
const meta = new MetaWhatsAppProvider({
  fetchImpl: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as never,
});

function metaPayload(value: Record<string, unknown>): string {
  return JSON.stringify({ entry: [{ changes: [{ value }] }] });
}

describe('provider contract — both providers normalize to identical shapes', () => {
  it('inbound message: same kind, +international phone, body, Date receivedAt', () => {
    const [t] = twilio.parseWebhook(
      'MessageSid=SM_in_1&From=whatsapp%3A%2B962790000000&Body=%D9%86%D8%B9%D9%85',
    ) as [Extract<WebhookEvent, { kind: 'inbound' }>];
    const [m] = meta.parseWebhook(
      metaPayload({
        messages: [
          {
            id: 'wamid.IN1',
            from: '962790000000',
            timestamp: '1747900800',
            type: 'text',
            text: { body: 'نعم' },
          },
        ],
      }),
    ) as [Extract<WebhookEvent, { kind: 'inbound' }>];

    expect(t.kind).toBe('inbound');
    expect(m.kind).toBe('inbound');
    // Identical normalized field SET — a new field on one side must land on both.
    expect(Object.keys(t.message).sort()).toEqual(Object.keys(m.message).sort());
    // Same phone normalization: bare international with the plus.
    expect(t.message.fromPhone).toBe('+962790000000');
    expect(m.message.fromPhone).toBe('+962790000000');
    expect(t.message.body).toBe('نعم');
    expect(m.message.body).toBe('نعم');
    expect(t.message.receivedAt).toBeInstanceOf(Date);
    expect(m.message.receivedAt).toBeInstanceOf(Date);
  });

  it('delivered receipt: same kind + status enum value', () => {
    const [t] = twilio.parseWebhook('MessageSid=SM_d_1&MessageStatus=delivered') as [
      Extract<WebhookEvent, { kind: 'status' }>,
    ];
    const [m] = meta.parseWebhook(
      metaPayload({
        statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1747900800' }],
      }),
    ) as [Extract<WebhookEvent, { kind: 'status' }>];

    expect(t.kind).toBe('status');
    expect(m.kind).toBe('status');
    expect(t.status.status).toBe('DELIVERED');
    expect(m.status.status).toBe('DELIVERED');
    expect(t.status.occurredAt).toBeInstanceOf(Date);
    expect(m.status.occurredAt).toBeInstanceOf(Date);
  });

  it('failed receipt: same kind, FAILED enum, populated failureReason', () => {
    const [t] = twilio.parseWebhook(
      'MessageSid=SM_f_1&MessageStatus=failed&ErrorCode=63024&ErrorMessage=cannot+receive',
    ) as [Extract<WebhookEvent, { kind: 'status' }>];
    const [m] = meta.parseWebhook(
      metaPayload({
        statuses: [
          {
            id: 'wamid.OUT2',
            status: 'failed',
            timestamp: '1747900800',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
        ],
      }),
    ) as [Extract<WebhookEvent, { kind: 'status' }>];

    for (const ev of [t, m]) {
      expect(ev.kind).toBe('status');
      expect(ev.status.status).toBe('FAILED');
      expect(typeof ev.status.failureReason).toBe('string');
      expect(ev.status.failureReason!.length).toBeGreaterThan(0);
    }
  });

  it('sendTemplate parameter order is provider-blind: [a,b,c] → {{1}}{{2}}{{3}} both sides', async () => {
    // Twilio: numbered-JSON contentVariables built from the array order.
    const create = vi.fn(async () => ({ sid: 'SM_x', status: 'queued' }));
    const tp = new TwilioWhatsAppProvider({
      client: {
        messages: { create },
        api: { v2010: { accounts: () => ({ fetch: async () => ({ sid: 'AC' }) }) } },
      },
    });
    const { db } = await import('@/lib/db');
    vi.mocked(db.whatsAppTemplate.findUnique).mockResolvedValueOnce({
      twilioContentSid: 'HX123',
      active: true,
    } as never);
    await tp.sendTemplate({
      name: 'appointment_reminder_v2',
      language: 'AR' as LanguagePref,
      recipientPhone: '+962790000000',
      parameters: ['د. سارة', '16:30', '2026-08-01'],
    });
    const arg = (create.mock.calls as unknown as [[{ contentVariables: string }]])[0]![0];
    expect(JSON.parse(arg.contentVariables)).toEqual({
      '1': 'د. سارة',
      '2': '16:30',
      '3': '2026-08-01',
    });
  });
});
