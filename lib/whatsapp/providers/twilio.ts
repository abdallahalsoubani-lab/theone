import { Twilio, validateRequest } from 'twilio';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

import { TemplateNotConfiguredError, WhatsAppError, describeWhatsAppError } from '../errors';
import type {
  DeliveryStatusEvent,
  InboundMessage,
  SendResult,
  SendTemplateParams,
  SendTextParams,
  WebhookEvent,
  WhatsAppProvider,
} from '../provider';

/**
 * Twilio WhatsApp provider.
 *
 * Production-grade implementation against the Twilio Programmable Messaging
 * REST API. The same class powers the sandbox (development + CI; sender
 * +14155238886, recipients must `join <code>` first) and Twilio production
 * WhatsApp numbers (paid, fully verified, no sandbox banner).
 *
 * Phone format: Twilio prefixes the WhatsApp address with `whatsapp:`. We
 * store bare international format (+962…) everywhere else; this provider
 * is the only place the prefix is added / stripped, so call sites never
 * need to know about it.
 *
 * Errors: WhatsAppError subclasses with `retryable=true` for transient
 * failures (HTTP 5xx, 429 rate limit, network timeouts) and false for
 * terminal ones (invalid number 21211, recipient opted out 63016, template
 * not configured). The outbound queue worker reads `retryable` to decide
 * whether to schedule another attempt.
 *
 * Tests inject a mock client via the `client` constructor argument; in
 * production / dev the constructor builds one from env. See
 * `__tests__/twilio.test.ts`.
 */

export interface TwilioClientLike {
  messages: {
    create(opts: {
      from: string;
      to: string;
      body?: string;
      contentSid?: string;
      contentVariables?: string;
      statusCallback?: string;
    }): Promise<{ sid: string; status: string }>;
  };
  api: {
    v2010: {
      accounts: (sid: string) => { fetch: () => Promise<{ sid: string }> };
    };
  };
}

export interface TwilioWhatsAppProviderOptions {
  client?: TwilioClientLike;
  accountSid?: string;
  authToken?: string;
  from?: string;
  /** Public webhook URL used to populate `statusCallback` on outbound sends. */
  statusCallbackUrl?: string | null;
}

/**
 * Maps Twilio's `MessageStatus` enum to our `WaMessageStatus`. Twilio
 * exposes more granular states (`queued`, `sending`, `accepted`); we
 * collapse the pre-delivery states to SENT and surface DELIVERED + READ
 * as their own terminal-but-positive states.
 */
export function mapTwilioStatus(status: string | null | undefined): SendResult['status'] {
  switch (status) {
    case 'delivered':
    case 'read':
    case 'sent':
      return 'SENT';
    case 'failed':
    case 'undelivered':
      return 'FAILED';
    case 'queued':
    case 'sending':
    case 'accepted':
    default:
      return 'QUEUED';
  }
}

function mapTwilioDeliveryStatus(status: string): DeliveryStatusEvent['status'] | null {
  switch (status) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
    case 'undelivered':
      return 'FAILED';
    default:
      return null;
  }
}

/** Twilio numeric error codes we map to terminal (non-retryable) failures. */
const TERMINAL_TWILIO_CODES = new Set<number>([
  21211, // Invalid 'To' Phone Number
  21408, // Permission to send to this number is denied
  21610, // Recipient unsubscribed (opted out)
  21614, // 'To' number is not a valid mobile number
  21617, // Concatenated message body exceeds maximum length
  63016, // Failed to send message because tester not opted in (Sandbox)
  63017, // Channel could not be reached at this time
  63018, // Message failed to send because recipient is invalid
  63024, // Number cannot receive WhatsApp messages
]);

function isTerminalTwilioError(code: number | string | undefined): boolean {
  if (code == null) return false;
  const n = typeof code === 'string' ? Number.parseInt(code, 10) : code;
  return Number.isFinite(n) && TERMINAL_TWILIO_CODES.has(n);
}

function wrapTwilioError(err: unknown): WhatsAppError {
  const e = err as { message?: string; code?: number | string; status?: number };
  const message = e?.message ?? String(err);
  const providerCode = e?.code;
  const httpStatus = e?.status ?? 0;
  // Placeholder / unregistered Twilio Content SID — the seed inserts fake
  // `HX_DEV_*` SIDs for local dev and Twilio rejects them with code 20422
  // ("Invalid Parameter"). Surface a friendly, actionable failure reason
  // instead of the raw "Invalid Parameter: ContentSid" string so the Admin
  // knows exactly what to fix in /admin/whatsapp/templates.
  const codeNum =
    typeof providerCode === 'string' ? Number.parseInt(providerCode, 10) : providerCode;
  if (codeNum === 20422 || /content\s*sid/i.test(message) || /HX[_A-Z0-9]+/.test(message)) {
    return new WhatsAppError({
      code: 'TEMPLATE_SID_INVALID',
      message,
      retryable: false,
      provider: 'twilio',
      providerCode,
    });
  }
  if (isTerminalTwilioError(providerCode)) {
    if (providerCode === 21610 || providerCode === 63016) {
      return new WhatsAppError({
        code: 'RECIPIENT_OPTED_OUT',
        message,
        retryable: false,
        provider: 'twilio',
        providerCode,
      });
    }
    return new WhatsAppError({
      code: 'INVALID_RECIPIENT',
      message,
      retryable: false,
      provider: 'twilio',
      providerCode,
    });
  }
  if (httpStatus === 429) {
    return new WhatsAppError({
      code: 'PROVIDER_RATE_LIMIT',
      message,
      retryable: true,
      provider: 'twilio',
      providerCode,
    });
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return new WhatsAppError({
      code: 'PROVIDER_AUTH',
      message,
      retryable: false,
      provider: 'twilio',
      providerCode,
    });
  }
  if (httpStatus >= 500 && httpStatus < 600) {
    return new WhatsAppError({
      code: 'PROVIDER_5XX',
      message,
      retryable: true,
      provider: 'twilio',
      providerCode,
    });
  }
  return new WhatsAppError({
    code: 'PROVIDER_UNKNOWN',
    message,
    retryable: true,
    provider: 'twilio',
    providerCode,
  });
}

/**
 * Convert our `[v1, v2, ...]` parameter shape to Twilio's
 * Content-Variables JSON of `{"1":"v1","2":"v2",...}`. Twilio matches by
 * numeric key, not order; explicit string keys are required.
 */
function buildContentVariables(parameters: ReadonlyArray<string>): string {
  const obj: Record<string, string> = {};
  parameters.forEach((value, i) => {
    obj[String(i + 1)] = value;
  });
  return JSON.stringify(obj);
}

function toWhatsAppAddress(phone: string): string {
  if (phone.startsWith('whatsapp:')) return phone;
  return `whatsapp:${phone}`;
}

function fromWhatsAppAddress(addr: string): string {
  return addr.startsWith('whatsapp:') ? addr.slice('whatsapp:'.length) : addr;
}

function parseUrlEncoded(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const key = decodeURIComponent(idx === -1 ? pair : pair.slice(0, idx)).replace(/\+/g, ' ');
    const value = idx === -1 ? '' : decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
    params[key] = value;
  }
  return params;
}

export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly id = 'twilio' as const;
  private readonly client: TwilioClientLike;
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly from: string;
  private readonly statusCallbackUrl: string | null;

  constructor(opts: TwilioWhatsAppProviderOptions = {}) {
    this.accountSid = opts.accountSid ?? env.TWILIO_ACCOUNT_SID ?? '';
    this.authToken = opts.authToken ?? env.TWILIO_AUTH_TOKEN ?? '';
    this.from = opts.from ?? env.TWILIO_WHATSAPP_FROM ?? '';
    this.statusCallbackUrl =
      opts.statusCallbackUrl !== undefined
        ? opts.statusCallbackUrl
        : env.NEXT_PUBLIC_APP_URL
          ? `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/v1/whatsapp/webhook/twilio`
          : null;
    if (opts.client) {
      this.client = opts.client;
    } else if (this.accountSid && this.authToken) {
      this.client = new Twilio(this.accountSid, this.authToken) as unknown as TwilioClientLike;
    } else {
      // No credentials supplied — keep a client-shaped placeholder that
      // throws on use. The factory still constructs the provider so the
      // boot-time health check can surface a clear failure.
      this.client = {
        messages: {
          create: () =>
            Promise.reject(
              new WhatsAppError({
                code: 'PROVIDER_AUTH',
                message: 'Twilio credentials missing — set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN.',
                retryable: false,
                provider: 'twilio',
              }),
            ),
        },
        api: {
          v2010: {
            accounts: () => ({
              fetch: () =>
                Promise.reject(
                  new WhatsAppError({
                    code: 'PROVIDER_AUTH',
                    message: 'Twilio credentials missing.',
                    retryable: false,
                    provider: 'twilio',
                  }),
                ),
            }),
          },
        },
      };
    }
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    const template = await db.whatsAppTemplate.findUnique({
      where: { name_language: { name: params.name, language: params.language } },
    });
    if (!template?.twilioContentSid || !template.active) {
      throw new TemplateNotConfiguredError({
        templateName: params.name,
        language: params.language,
        provider: 'twilio',
      });
    }
    try {
      const message = await this.client.messages.create({
        from: toWhatsAppAddress(this.from),
        to: toWhatsAppAddress(params.recipientPhone),
        contentSid: template.twilioContentSid,
        contentVariables: buildContentVariables(params.parameters),
        ...(this.statusCallbackUrl ? { statusCallback: this.statusCallbackUrl } : {}),
      });
      return {
        providerMessageId: message.sid ?? null,
        status: mapTwilioStatus(message.status),
      };
    } catch (err) {
      throw wrapTwilioError(err);
    }
  }

  async sendText(params: SendTextParams): Promise<SendResult> {
    try {
      const message = await this.client.messages.create({
        from: toWhatsAppAddress(this.from),
        to: toWhatsAppAddress(params.recipientPhone),
        body: params.body,
        ...(this.statusCallbackUrl ? { statusCallback: this.statusCallbackUrl } : {}),
      });
      return {
        providerMessageId: message.sid ?? null,
        status: mapTwilioStatus(message.status),
      };
    } catch (err) {
      throw wrapTwilioError(err);
    }
  }

  /**
   * Verify the X-Twilio-Signature header against the request body. Twilio
   * computes the HMAC over the public URL plus form fields in sorted key
   * order — we pass both in via the handler.
   */
  verifyWebhook(args: { rawBody: string; signature: string; url: string }): boolean {
    if (!this.authToken || !args.signature) return false;
    try {
      const params = parseUrlEncoded(args.rawBody);
      return validateRequest(this.authToken, args.signature, args.url, params);
    } catch {
      return false;
    }
  }

  /**
   * Parse a verified Twilio webhook body. Twilio sends two shapes through
   * the same endpoint depending on which callback fired:
   *   - Status callback: includes `MessageStatus` and `MessageSid`
   *   - Inbound message: includes `From`, `Body`, `MessageSid`, and no
   *     `MessageStatus`
   */
  parseWebhook(rawBody: string): WebhookEvent[] {
    let params: Record<string, string>;
    try {
      params = parseUrlEncoded(rawBody);
    } catch {
      return [];
    }
    const sid = params['MessageSid'] ?? params['SmsSid'];
    if (!sid) return [];

    if (params['MessageStatus']) {
      const mapped = mapTwilioDeliveryStatus(params['MessageStatus']);
      if (!mapped) return [];
      const event: DeliveryStatusEvent = {
        providerMessageId: sid,
        status: mapped,
        occurredAt: new Date(),
      };
      if (mapped === 'FAILED') {
        const code = params['ErrorCode'];
        const msg = params['ErrorMessage'];
        event.failureReason = [code && `[${code}]`, msg].filter(Boolean).join(' ') || 'failed';
      }
      return [{ kind: 'status', status: event }];
    }

    const from = params['From'] ?? params['WaId'];
    const body = params['Body'] ?? '';
    if (!from) return [];
    const inbound: InboundMessage = {
      providerMessageId: sid,
      fromPhone: fromWhatsAppAddress(from),
      body,
      receivedAt: new Date(),
    };
    return [{ kind: 'inbound', message: inbound }];
  }

  async healthCheck(): Promise<boolean> {
    if (!this.accountSid) return false;
    try {
      const account = await this.client.api.v2010.accounts(this.accountSid).fetch();
      return !!account?.sid;
    } catch (err) {
      console.warn(`[whatsapp.twilio] health check failed: ${describeWhatsAppError(err)}`);
      return false;
    }
  }
}
