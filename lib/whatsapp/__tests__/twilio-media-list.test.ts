import { describe, expect, it, vi } from 'vitest';

import { WhatsAppError } from '../errors';
import { TwilioWhatsAppProvider, type TwilioClientLike } from '../providers/twilio';

/**
 * P62-session follow-up — `listMessageMedia`: the re-fetch path for inbound
 * attachments that FAILED on the webhook-time download. Asserts the REST call
 * (account-scoped URL, Basic auth), the stable content URL (the `.json`
 * resource suffix stripped), creation-time ordering → `index`, and the error
 * mapping the repair script reports per row.
 */

vi.mock('@/lib/db', () => ({ db: { whatsAppTemplate: { findUnique: vi.fn(async () => null) } } }));
vi.mock('@/lib/env', () => ({
  env: {
    TWILIO_ACCOUNT_SID: 'ACenv',
    TWILIO_AUTH_TOKEN: 'tokenv',
    TWILIO_WHATSAPP_FROM: 'whatsapp:+10000000000',
    NEXT_PUBLIC_APP_URL: 'https://example.test',
  },
}));

const client: TwilioClientLike = {
  messages: { create: vi.fn(async () => ({ sid: 'SM1', status: 'queued' })) },
  api: { v2010: { accounts: () => ({ fetch: async () => ({ sid: 'AC123' }) }) } },
};

const MM = 'MM0123456789abcdef0123456789abcdef';

function provider(fetchImpl: typeof fetch) {
  return new TwilioWhatsAppProvider({
    client,
    accountSid: 'AC123',
    authToken: 'tok',
    from: 'whatsapp:+10000000000',
    statusCallbackUrl: null,
    fetchImpl,
  });
}

describe('TwilioWhatsAppProvider.listMessageMedia', () => {
  it('GETs the account-scoped Media.json with Basic auth and maps items in creation order', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        media_list: [
          {
            sid: 'ME2',
            content_type: 'image/jpeg',
            uri: '/2010-04-01/Accounts/AC123/Messages/MM1/Media/ME2.json',
            date_created: 'Wed, 07 Oct 2026 13:52:02 +0000',
          },
          {
            sid: 'ME1',
            content_type: 'application/pdf',
            uri: '/2010-04-01/Accounts/AC123/Messages/MM1/Media/ME1.json',
            date_created: 'Wed, 07 Oct 2026 13:52:01 +0000',
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const items = await provider(fetchMock).listMessageMedia(MM);

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]! as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/${MM}/Media.json?PageSize=50`,
    );
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC123:tok').toString('base64')}`);
    expect(items).toEqual([
      {
        index: 0,
        url: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM1/Media/ME1',
        contentType: 'application/pdf',
      },
      {
        index: 1,
        url: 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM1/Media/ME2',
        contentType: 'image/jpeg',
      },
    ]);
  });

  it('an empty media_list → []', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ media_list: [] }),
    })) as unknown as typeof fetch;
    expect(await provider(fetchMock).listMessageMedia(MM)).toEqual([]);
  });

  it('rejects a non-Twilio message id before calling the API', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    await expect(provider(fetchMock).listMessageMedia('wamid.abc')).rejects.toBeInstanceOf(
      WhatsAppError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 404 → PROVIDER_UNKNOWN (not retryable), 401 → PROVIDER_AUTH, 503 → PROVIDER_5XX (retryable)', async () => {
    const mk = (status: number) =>
      vi.fn(async () => ({ ok: false, status, json: async () => ({}) })) as unknown as typeof fetch;
    const e404 = await provider(mk(404))
      .listMessageMedia(MM)
      .catch((e: unknown) => e as WhatsAppError);
    expect(e404).toMatchObject({ code: 'PROVIDER_UNKNOWN', retryable: false, providerCode: 404 });
    const e401 = await provider(mk(401))
      .listMessageMedia(MM)
      .catch((e: unknown) => e as WhatsAppError);
    expect(e401).toMatchObject({ code: 'PROVIDER_AUTH', retryable: false });
    const e503 = await provider(mk(503))
      .listMessageMedia(MM)
      .catch((e: unknown) => e as WhatsAppError);
    expect(e503).toMatchObject({ code: 'PROVIDER_5XX', retryable: true });
  });

  it('without credentials → PROVIDER_AUTH, no network call', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const p = new TwilioWhatsAppProvider({
      client,
      accountSid: '',
      authToken: '',
      from: 'x',
      statusCallbackUrl: null,
      fetchImpl: fetchMock,
    });
    await expect(p.listMessageMedia(MM)).rejects.toMatchObject({ code: 'PROVIDER_AUTH' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
