import { createHmac } from 'node:crypto';

import { LanguagePref } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateNotConfiguredError, WhatsAppError } from '../errors';
import { MetaWhatsAppProvider, type FetchLike } from '../providers/meta';

vi.mock('@/lib/db', () => {
  let template: {
    id: string;
    name: string;
    language: LanguagePref;
    active: boolean;
    metaTemplateName: string | null;
    metaApprovalStatus: string;
  } | null = null;
  return {
    db: {
      whatsAppTemplate: {
        findUnique: vi.fn(async () => template),
      },
    },
    __setTemplate: (t: typeof template) => {
      template = t;
    },
  };
});

vi.mock('@/lib/env', () => ({
  env: {
    META_WHATSAPP_PHONE_NUMBER_ID: 'PHONE_ID_TEST',
    META_WHATSAPP_ACCESS_TOKEN: 'token_test',
    META_WHATSAPP_APP_SECRET: 'app_secret_test',
    NEXT_PUBLIC_APP_URL: 'https://example.com',
  },
}));

import * as dbModule from '@/lib/db';
const setTemplate = (dbModule as unknown as { __setTemplate: (t: unknown) => void }).__setTemplate;

interface FakeResponse {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  json: unknown;
}

function fakeFetch(
  responses: FakeResponse | FakeResponse[],
  recorder?: { calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> },
): FetchLike {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  return async (url, init) => {
    recorder?.calls.push({ url, init });
    const next = queue.shift() ?? queue[queue.length - 1] ?? { ok: false, status: 500, json: {} };
    const headers = next.headers ?? {};
    return {
      ok: next.ok,
      status: next.status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? headers[n] ?? null },
      json: async () => next.json,
      text: async () => JSON.stringify(next.json),
    };
  };
}

describe('MetaWhatsAppProvider.sendTemplate', () => {
  beforeEach(() => {
    setTemplate({
      id: 't1',
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      active: true,
      metaTemplateName: 'appointment_reminder_30min',
      metaApprovalStatus: 'APPROVED',
    });
  });

  it('posts to Graph API with template + body parameters and returns wamid', async () => {
    const recorder = { calls: [] as Array<{ url: string; init?: Parameters<FetchLike>[1] }> };
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch(
        { ok: true, status: 200, json: { messages: [{ id: 'wamid.ABC123' }] } },
        recorder,
      ),
    });
    const res = await provider.sendTemplate({
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      recipientPhone: '+962790000000',
      parameters: ['Dr Smith', '10:30 AM'],
    });
    expect(res.providerMessageId).toBe('wamid.ABC123');
    expect(res.status).toBe('SENT');
    const call = recorder.calls[0]!;
    expect(call.url).toBe('https://graph.facebook.com/v20.0/PHONE_ID_TEST/messages');
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers?.['Authorization']).toBe('Bearer token_test');
    const sentBody = JSON.parse(call.init!.body!);
    expect(sentBody).toMatchObject({
      messaging_product: 'whatsapp',
      to: '962790000000',
      type: 'template',
      template: {
        name: 'appointment_reminder_30min',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Dr Smith' },
              { type: 'text', text: '10:30 AM' },
            ],
          },
        ],
      },
    });
  });

  it('uses language code "ar" for Arabic templates', async () => {
    setTemplate({
      id: 't2',
      name: 'appointment_reminder_30min',
      language: LanguagePref.AR,
      active: true,
      metaTemplateName: 'appointment_reminder_30min',
      metaApprovalStatus: 'APPROVED',
    });
    const recorder = { calls: [] as Array<{ url: string; init?: Parameters<FetchLike>[1] }> };
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch(
        { ok: true, status: 200, json: { messages: [{ id: 'wamid.ar1' }] } },
        recorder,
      ),
    });
    await provider.sendTemplate({
      name: 'appointment_reminder_30min',
      language: LanguagePref.AR,
      recipientPhone: '+962790000000',
      parameters: [],
    });
    const sentBody = JSON.parse(recorder.calls[0]!.init!.body!);
    expect(sentBody.template.language.code).toBe('ar');
    expect(sentBody.template.components).toEqual([]);
  });

  it('refuses when metaApprovalStatus is not APPROVED', async () => {
    setTemplate({
      id: 't1',
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      active: true,
      metaTemplateName: 'appointment_reminder_30min',
      metaApprovalStatus: 'PENDING',
    });
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({ ok: true, status: 200, json: { messages: [{ id: 'x' }] } }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toBeInstanceOf(TemplateNotConfiguredError);
  });

  it('refuses when metaTemplateName is missing', async () => {
    setTemplate({
      id: 't1',
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      active: true,
      metaTemplateName: null,
      metaApprovalStatus: 'APPROVED',
    });
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({ ok: true, status: 200, json: { messages: [{ id: 'x' }] } }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toBeInstanceOf(TemplateNotConfiguredError);
  });

  it('maps Meta 132016 (template disabled) to TEMPLATE_NOT_APPROVED, non-retryable', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({
        ok: false,
        status: 400,
        json: { error: { message: 'Template paused', code: 132016 } },
      }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_APPROVED', retryable: false });
  });

  it('maps Meta 131026 (no longer on WhatsApp) to RECIPIENT_OPTED_OUT', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({
        ok: false,
        status: 400,
        json: { error: { message: 'undeliverable', code: 131026 } },
      }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'RECIPIENT_OPTED_OUT', retryable: false });
  });

  it('maps Meta 131047 (24h window expired) to NOT_IN_24H_WINDOW', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({
        ok: false,
        status: 400,
        json: { error: { message: '24h expired', code: 131047 } },
      }),
    });
    await expect(
      provider.sendText({ recipientPhone: '+962790000000', body: 'hi' }),
    ).rejects.toMatchObject({ code: 'NOT_IN_24H_WINDOW', retryable: false });
  });

  it('maps Meta 131000 (generic user error) to INVALID_RECIPIENT', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({
        ok: false,
        status: 400,
        json: { error: { message: 'bad number', code: 131000 } },
      }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RECIPIENT', retryable: false });
  });

  it('maps HTTP 401 to PROVIDER_AUTH (non-retryable)', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({
        ok: false,
        status: 401,
        json: { error: { message: 'bad token' } },
      }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_AUTH', retryable: false });
  });

  it('maps HTTP 429 to PROVIDER_RATE_LIMIT (retryable) and parses Retry-After', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({
        ok: false,
        status: 429,
        headers: { 'retry-after': '30' },
        json: { error: { message: 'rate limited' } },
      }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMIT',
      retryable: true,
      retryAfterMs: 30000,
    });
  });

  it('maps HTTP 503 to PROVIDER_5XX (retryable)', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({
        ok: false,
        status: 503,
        json: { error: { message: 'upstream' } },
      }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_5XX', retryable: true });
  });

  it('wraps a fetch-level rejection as PROVIDER_NETWORK (retryable)', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NETWORK', retryable: true });
  });

  it('throws PROVIDER_AUTH when phoneId / token are missing', async () => {
    const provider = new MetaWhatsAppProvider({
      phoneId: '',
      token: '',
      fetchImpl: fakeFetch({ ok: true, status: 200, json: {} }),
    });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toBeInstanceOf(WhatsAppError);
  });
});

describe('MetaWhatsAppProvider.verifyWebhook', () => {
  const provider = new MetaWhatsAppProvider({
    fetchImpl: fakeFetch({ ok: true, status: 200, json: {} }),
  });

  it('returns true on a correctly signed body', () => {
    const body = '{"foo":"bar"}';
    const sig =
      'sha256=' + createHmac('sha256', 'app_secret_test').update(body, 'utf8').digest('hex');
    expect(provider.verifyWebhook({ rawBody: body, signature: sig, url: '' })).toBe(true);
  });

  it('returns false on a tampered body', () => {
    const body = '{"foo":"bar"}';
    const sig =
      'sha256=' + createHmac('sha256', 'app_secret_test').update(body, 'utf8').digest('hex');
    expect(provider.verifyWebhook({ rawBody: body + 'tamper', signature: sig, url: '' })).toBe(
      false,
    );
  });

  it('returns false when the prefix is missing', () => {
    expect(provider.verifyWebhook({ rawBody: '{}', signature: 'deadbeef', url: '' })).toBe(false);
  });

  it('returns false on length mismatch (defends against timingSafeEqual throw)', () => {
    expect(provider.verifyWebhook({ rawBody: '{}', signature: 'sha256=abc', url: '' })).toBe(false);
  });

  it('returns false when appSecret is missing', () => {
    const noSecret = new MetaWhatsAppProvider({
      appSecret: '',
      fetchImpl: fakeFetch({ ok: true, status: 200, json: {} }),
    });
    expect(
      noSecret.verifyWebhook({
        rawBody: '{}',
        signature: 'sha256=' + '0'.repeat(64),
        url: '',
      }),
    ).toBe(false);
  });
});

describe('MetaWhatsAppProvider.parseWebhook', () => {
  const provider = new MetaWhatsAppProvider({
    fetchImpl: fakeFetch({ ok: true, status: 200, json: {} }),
  });

  it('parses an inbound text message', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.IN1',
                    from: '962790000000',
                    timestamp: '1747900800',
                    type: 'text',
                    text: { body: 'نعم' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = provider.parseWebhook(JSON.stringify(payload));
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.kind).toBe('inbound');
    if (ev.kind === 'inbound') {
      expect(ev.message.fromPhone).toBe('+962790000000');
      expect(ev.message.body).toBe('نعم');
      expect(ev.message.providerMessageId).toBe('wamid.IN1');
      expect(ev.message.receivedAt.getTime()).toBe(1747900800 * 1000);
    }
  });

  it('extracts body from interactive button_reply replies', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.IN2',
                    from: '962790000001',
                    type: 'interactive',
                    interactive: { button_reply: { title: 'Confirm' } },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const events = provider.parseWebhook(JSON.stringify(payload));
    const ev = events[0]!;
    if (ev.kind !== 'inbound') throw new Error('expected inbound');
    expect(ev.message.body).toBe('Confirm');
  });

  it('parses a delivered status event', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1747900800' }],
              },
            },
          ],
        },
      ],
    };
    const events = provider.parseWebhook(JSON.stringify(payload));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'status',
      status: { providerMessageId: 'wamid.OUT1', status: 'DELIVERED' },
    });
  });

  it('parses a failed status event with error details', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: 'wamid.OUT2',
                    status: 'failed',
                    errors: [{ code: 131026, title: 'Undeliverable', message: 'no whatsapp' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const ev = provider.parseWebhook(JSON.stringify(payload))[0]!;
    if (ev.kind !== 'status') throw new Error('expected status');
    expect(ev.status.status).toBe('FAILED');
    expect(ev.status.failureReason).toBe('[131026] Undeliverable no whatsapp');
  });

  it('returns [] on malformed JSON', () => {
    expect(provider.parseWebhook('not-json')).toEqual([]);
  });

  it('returns [] when payload has no entries', () => {
    expect(provider.parseWebhook('{}')).toEqual([]);
  });

  it('handles multiple events in a single payload', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ id: 'wamid.A', from: '962700000001', text: { body: 'yes' } }],
                statuses: [{ id: 'wamid.B', status: 'read' }],
              },
            },
          ],
        },
      ],
    };
    const events = provider.parseWebhook(JSON.stringify(payload));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.kind).sort()).toEqual(['inbound', 'status']);
  });
});

describe('MetaWhatsAppProvider.healthCheck', () => {
  it('returns true when GET /<phoneId> returns ok', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({ ok: true, status: 200, json: { id: 'PHONE_ID_TEST' } }),
    });
    await expect(provider.healthCheck()).resolves.toBe(true);
  });

  it('returns false on HTTP failure', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: fakeFetch({ ok: false, status: 401, json: { error: { message: 'bad' } } }),
    });
    await expect(provider.healthCheck()).resolves.toBe(false);
  });

  it('returns false on fetch rejection', async () => {
    const provider = new MetaWhatsAppProvider({
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    await expect(provider.healthCheck()).resolves.toBe(false);
  });

  it('returns false when token/phoneId are missing', async () => {
    const provider = new MetaWhatsAppProvider({
      phoneId: '',
      token: '',
      fetchImpl: fakeFetch({ ok: true, status: 200, json: {} }),
    });
    await expect(provider.healthCheck()).resolves.toBe(false);
  });
});
