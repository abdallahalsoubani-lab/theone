import { LanguagePref } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateNotConfiguredError, WhatsAppError } from '../errors';
import {
  TwilioWhatsAppProvider,
  mapTwilioStatus,
  type TwilioClientLike,
} from '../providers/twilio';

// In-memory template stub. Each test resets via `__setTemplate`.
vi.mock('@/lib/db', () => {
  let template: {
    id: string;
    name: string;
    language: LanguagePref;
    active: boolean;
    twilioContentSid: string | null;
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

// Live env values would change the constructor. Force a deterministic shape
// for these tests so the provider doesn't try to read .env.local under us.
vi.mock('@/lib/env', () => ({
  env: {
    TWILIO_ACCOUNT_SID: 'AC_test',
    TWILIO_AUTH_TOKEN: 'auth_token_secret',
    TWILIO_WHATSAPP_FROM: '+14155238886',
    NEXT_PUBLIC_APP_URL: 'https://example.com',
  },
}));

import * as dbModule from '@/lib/db';
const setTemplate = (dbModule as unknown as { __setTemplate: (t: unknown) => void }).__setTemplate;

function fakeClient(overrides: Partial<TwilioClientLike['messages']> = {}): TwilioClientLike {
  return {
    messages: {
      create: vi.fn(async () => ({ sid: 'SM_test_123', status: 'queued' })),
      ...overrides,
    },
    api: {
      v2010: {
        accounts: () => ({ fetch: async () => ({ sid: 'AC_test' }) }),
      },
    },
  };
}

describe('mapTwilioStatus', () => {
  it.each([
    ['delivered', 'SENT'],
    ['read', 'SENT'],
    ['sent', 'SENT'],
    ['queued', 'QUEUED'],
    ['sending', 'QUEUED'],
    ['accepted', 'QUEUED'],
    ['failed', 'FAILED'],
    ['undelivered', 'FAILED'],
    [undefined, 'QUEUED'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapTwilioStatus(input ?? undefined)).toBe(expected);
  });
});

describe('TwilioWhatsAppProvider.sendTemplate', () => {
  beforeEach(() => {
    setTemplate({
      id: 't1',
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      active: true,
      twilioContentSid: 'HX_real_content_sid',
    });
  });

  it('sends a template via the Twilio client with whatsapp: prefix and content variables', async () => {
    const client = fakeClient();
    const provider = new TwilioWhatsAppProvider({ client });
    const res = await provider.sendTemplate({
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      recipientPhone: '+962790000000',
      parameters: ['Dr Smith', '10:30 AM'],
    });
    expect(res.providerMessageId).toBe('SM_test_123');
    expect(res.status).toBe('QUEUED');
    const createMock = client.messages.create as ReturnType<typeof vi.fn>;
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0]![0];
    expect(call.from).toBe('whatsapp:+14155238886');
    expect(call.to).toBe('whatsapp:+962790000000');
    expect(call.contentSid).toBe('HX_real_content_sid');
    expect(JSON.parse(call.contentVariables)).toEqual({ '1': 'Dr Smith', '2': '10:30 AM' });
    expect(call.statusCallback).toBe('https://example.com/api/v1/whatsapp/webhook/twilio');
  });

  it('throws TemplateNotConfiguredError when the template row is missing', async () => {
    setTemplate(null);
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    await expect(
      provider.sendTemplate({
        name: 'missing_template',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toBeInstanceOf(TemplateNotConfiguredError);
  });

  it('throws TemplateNotConfiguredError when twilioContentSid is null', async () => {
    setTemplate({
      id: 't1',
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      active: true,
      twilioContentSid: null,
    });
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toBeInstanceOf(TemplateNotConfiguredError);
  });

  it('wraps a terminal Twilio error (21610 unsubscribed) as RECIPIENT_OPTED_OUT', async () => {
    const client = fakeClient({
      create: vi.fn(async () => {
        const err = new Error('The recipient has opted out') as Error & {
          code: number;
          status: number;
        };
        err.code = 21610;
        err.status = 400;
        throw err;
      }),
    });
    const provider = new TwilioWhatsAppProvider({ client });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({
      code: 'RECIPIENT_OPTED_OUT',
      retryable: false,
      provider: 'twilio',
      providerCode: 21610,
    });
  });

  it('wraps Sandbox 63016 (recipient not opted in) as RECIPIENT_OPTED_OUT, non-retryable', async () => {
    const client = fakeClient({
      create: vi.fn(async () => {
        const err = new Error('not joined') as Error & { code: number; status: number };
        err.code = 63016;
        err.status = 400;
        throw err;
      }),
    });
    const provider = new TwilioWhatsAppProvider({ client });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'RECIPIENT_OPTED_OUT', retryable: false });
  });

  it('wraps invalid To 21211 as INVALID_RECIPIENT, non-retryable', async () => {
    const client = fakeClient({
      create: vi.fn(async () => {
        const err = new Error('invalid number') as Error & { code: number; status: number };
        err.code = 21211;
        err.status = 400;
        throw err;
      }),
    });
    const provider = new TwilioWhatsAppProvider({ client });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RECIPIENT', retryable: false });
  });

  it('wraps 429 as PROVIDER_RATE_LIMIT, retryable', async () => {
    const client = fakeClient({
      create: vi.fn(async () => {
        const err = new Error('rate limited') as Error & { status: number };
        err.status = 429;
        throw err;
      }),
    });
    const provider = new TwilioWhatsAppProvider({ client });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMIT', retryable: true });
  });

  it('wraps 503 as PROVIDER_5XX, retryable', async () => {
    const client = fakeClient({
      create: vi.fn(async () => {
        const err = new Error('upstream gone') as Error & { status: number };
        err.status = 503;
        throw err;
      }),
    });
    const provider = new TwilioWhatsAppProvider({ client });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_5XX', retryable: true });
  });

  it('wraps 401 as PROVIDER_AUTH, non-retryable', async () => {
    const client = fakeClient({
      create: vi.fn(async () => {
        const err = new Error('bad token') as Error & { status: number };
        err.status = 401;
        throw err;
      }),
    });
    const provider = new TwilioWhatsAppProvider({ client });
    await expect(
      provider.sendTemplate({
        name: 'appointment_reminder_30min',
        language: LanguagePref.EN,
        recipientPhone: '+962790000000',
        parameters: [],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_AUTH', retryable: false });
  });

  it('accepts an already-prefixed whatsapp: recipient without double-prefixing', async () => {
    const client = fakeClient();
    const provider = new TwilioWhatsAppProvider({ client });
    await provider.sendTemplate({
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      recipientPhone: 'whatsapp:+962790000000',
      parameters: [],
    });
    const createMock = client.messages.create as ReturnType<typeof vi.fn>;
    expect(createMock.mock.calls[0]![0].to).toBe('whatsapp:+962790000000');
  });
});

describe('TwilioWhatsAppProvider.sendText', () => {
  it('sends free-form text without consulting the template table', async () => {
    const client = fakeClient();
    const provider = new TwilioWhatsAppProvider({ client });
    const res = await provider.sendText({
      recipientPhone: '+962790000000',
      body: 'Thank you, see you Sunday.',
    });
    expect(res.providerMessageId).toBe('SM_test_123');
    const createMock = client.messages.create as ReturnType<typeof vi.fn>;
    const call = createMock.mock.calls[0]![0];
    expect(call.body).toBe('Thank you, see you Sunday.');
    expect(call.contentSid).toBeUndefined();
  });
});

describe('TwilioWhatsAppProvider.verifyWebhook', () => {
  it('rejects when authToken is missing', () => {
    const provider = new TwilioWhatsAppProvider({
      client: fakeClient(),
      authToken: '',
      accountSid: 'AC',
      from: '+1',
    });
    expect(
      provider.verifyWebhook({
        rawBody: 'MessageSid=SM_test',
        signature: 'whatever',
        url: 'https://example.com/api/v1/whatsapp/webhook/twilio',
      }),
    ).toBe(false);
  });

  it('rejects when signature header is empty', () => {
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    expect(
      provider.verifyWebhook({
        rawBody: 'MessageSid=SM_test',
        signature: '',
        url: 'https://example.com/api/v1/whatsapp/webhook/twilio',
      }),
    ).toBe(false);
  });

  it('rejects a tampered body even with otherwise plausible inputs', () => {
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    expect(
      provider.verifyWebhook({
        rawBody: 'MessageSid=SM_tampered&Body=evil',
        signature: 'not-the-real-hmac',
        url: 'https://example.com/api/v1/whatsapp/webhook/twilio',
      }),
    ).toBe(false);
  });
});

describe('TwilioWhatsAppProvider.parseWebhook', () => {
  it('parses an inbound message payload', () => {
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    const events = provider.parseWebhook(
      'MessageSid=SM_in_123&From=whatsapp%3A%2B962790000000&Body=%D9%86%D8%B9%D9%85',
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'inbound',
      message: expect.objectContaining({
        providerMessageId: 'SM_in_123',
        fromPhone: '+962790000000',
        body: 'نعم',
      }),
    });
  });

  it('parses a delivered status callback', () => {
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    const events = provider.parseWebhook('MessageSid=SM_st_1&MessageStatus=delivered');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'status',
      status: { providerMessageId: 'SM_st_1', status: 'DELIVERED' },
    });
  });

  it('parses a failed status callback with error code and message', () => {
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    const events = provider.parseWebhook(
      'MessageSid=SM_st_2&MessageStatus=failed&ErrorCode=63016&ErrorMessage=not%20opted%20in',
    );
    expect(events[0]).toMatchObject({
      kind: 'status',
      status: { providerMessageId: 'SM_st_2', status: 'FAILED' },
    });
    const ev = events[0];
    if (ev && ev.kind === 'status') {
      expect(ev.status.failureReason).toBe('[63016] not opted in');
    } else {
      throw new Error('expected a status event');
    }
  });

  it('returns [] for unrecognized status values (queued / sending)', () => {
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    expect(provider.parseWebhook('MessageSid=SM_a&MessageStatus=queued')).toEqual([]);
    expect(provider.parseWebhook('MessageSid=SM_a&MessageStatus=sending')).toEqual([]);
  });

  it('returns [] when MessageSid is absent', () => {
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    expect(provider.parseWebhook('Body=hello&From=whatsapp%3A%2B962')).toEqual([]);
  });
});

describe('TwilioWhatsAppProvider.healthCheck', () => {
  it('returns true when account.fetch resolves', async () => {
    const provider = new TwilioWhatsAppProvider({ client: fakeClient() });
    await expect(provider.healthCheck()).resolves.toBe(true);
  });

  it('returns false when the SDK throws', async () => {
    const provider = new TwilioWhatsAppProvider({
      client: {
        ...fakeClient(),
        api: {
          v2010: {
            accounts: () => ({
              fetch: async () => {
                throw new Error('network down');
              },
            }),
          },
        },
      },
    });
    await expect(provider.healthCheck()).resolves.toBe(false);
  });

  it('returns false when accountSid is missing', async () => {
    const provider = new TwilioWhatsAppProvider({
      client: fakeClient(),
      accountSid: '',
      authToken: 't',
      from: '+1',
    });
    await expect(provider.healthCheck()).resolves.toBe(false);
  });
});

describe('TwilioWhatsAppProvider constructor without credentials', () => {
  it('builds a stub client that rejects with PROVIDER_AUTH', async () => {
    const provider = new TwilioWhatsAppProvider({
      accountSid: '',
      authToken: '',
      from: '',
    });
    setTemplate({
      id: 't1',
      name: 'appointment_reminder_30min',
      language: LanguagePref.EN,
      active: true,
      twilioContentSid: 'HX_real',
    });
    await expect(
      provider.sendText({ recipientPhone: '+962790000000', body: 'x' }),
    ).rejects.toBeInstanceOf(WhatsAppError);
  });
});
