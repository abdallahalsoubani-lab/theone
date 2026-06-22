import { createHmac, timingSafeEqual } from 'node:crypto';

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
 * Meta WhatsApp Cloud API provider.
 *
 * Direct fetch against Graph API v20.0 — no SDK dependency. Used in
 * production at scale. Requires Meta Business verification (1–2 weeks) and a
 * dedicated phone number that is not active in personal WhatsApp.
 *
 * Two Meta-specific rules baked into this module:
 *
 * 1. The 24-hour customer service window. Free-form messages (sendText)
 *    are only allowed within 24 hours of the patient's last inbound. Our
 *    outbound is template-based for proactive sends; sendText is reserved
 *    for inline acknowledgements the inbound parser fires immediately
 *    after parsing a reply — those are always inside the window.
 *
 * 2. Template approval. sendTemplate refuses if metaApprovalStatus !==
 *    'APPROVED'. The Admin manually toggles approval status in
 *    /admin/whatsapp/templates after Meta confirms in Business Manager;
 *    a future enhancement could poll Meta's template management API.
 *
 * Tests inject a custom fetch via the constructor; in production /
 * dev the constructor uses the global fetch.
 */

const DEFAULT_GRAPH_VERSION = 'v20.0';

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface MetaWhatsAppProviderOptions {
  fetchImpl?: FetchLike;
  phoneId?: string;
  token?: string;
  appSecret?: string;
  graphVersion?: string;
}

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
}

interface MetaInboundMessageRaw {
  id: string;
  from: string;
  type?: string;
  timestamp?: string;
  text?: { body: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
}

interface MetaWebhookEntry {
  changes?: Array<{
    value?: {
      messages?: MetaInboundMessageRaw[];
      statuses?: Array<{
        id: string;
        status: string;
        timestamp?: string;
        errors?: Array<{ code?: number; title?: string; message?: string }>;
      }>;
    };
  }>;
}

interface MetaWebhookPayload {
  entry?: MetaWebhookEntry[];
}

/**
 * Codes treated as terminal (non-retryable). Meta lists hundreds of error
 * codes; the ones below are the realistic terminals — invalid recipient,
 * permission denied, template not approved, opted out. Anything else
 * falls through to retryable so transient network/server failures get
 * another chance.
 */
const TERMINAL_META_CODES = new Set<number>([
  131000, // Generic user error (invalid number, etc.)
  131005, // Access denied (Meta has not granted permission)
  131008, // Required parameter missing
  131009, // Parameter value not valid
  131021, // Recipient cannot be sender (loop attempt)
  131026, // Message undeliverable (no longer on WhatsApp)
  131031, // Account has been locked
  131047, // Re-engagement message — 24h window expired
  131051, // Unsupported message type
  131053, // Media upload error
  132000, // Template name does not exist
  132001, // Template language does not exist
  132005, // Template hydrated text too long
  132007, // Template format character policy violated
  132012, // Template parameter value mismatch
  132015, // Template paused
  132016, // Template disabled
  132068, // Template provider business not approved
]);

function isTerminalMetaCode(code: number | undefined): boolean {
  return code != null && TERMINAL_META_CODES.has(code);
}

function metaStatusFromString(status: string): DeliveryStatusEvent['status'] | null {
  switch (status) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}

function normalizeMetaPhone(raw: string): string {
  // Meta gives the phone in bare international format without the `+`,
  // e.g., `962790000000`. Our app stores `+962…`, so add the plus back.
  return raw.startsWith('+') ? raw : `+${raw}`;
}

function languageCode(language: 'EN' | 'AR'): string {
  // Normal per-language mapping.
  const approved = language === 'AR' ? 'ar' : 'en';
  // TEMPORARY FALLBACK (2026-06-22 WhatsApp incident): Meta currently has only
  // the Arabic template translations approved. Sending the `en` code fails with
  // error #132001 "Template language does not exist", so every English send
  // bounces. Until the English translations are approved in Meta, route EN
  // sends to the approved `ar` translation as well. To restore per-language
  // codes once EN is live, delete the next line and `return approved`.
  return approved === 'en' ? 'ar' : approved;
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly id = 'meta' as const;
  private readonly fetchImpl: FetchLike;
  private readonly phoneId: string;
  private readonly token: string;
  private readonly appSecret: string;
  private readonly base: string;

  constructor(opts: MetaWhatsAppProviderOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
    this.phoneId = opts.phoneId ?? env.META_WHATSAPP_PHONE_NUMBER_ID ?? '';
    this.token = opts.token ?? env.META_WHATSAPP_ACCESS_TOKEN ?? '';
    this.appSecret = opts.appSecret ?? env.META_WHATSAPP_APP_SECRET ?? '';
    const version = opts.graphVersion ?? DEFAULT_GRAPH_VERSION;
    this.base = `https://graph.facebook.com/${version}/${this.phoneId}`;
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    if (!this.token || !this.phoneId) {
      throw new WhatsAppError({
        code: 'PROVIDER_AUTH',
        message:
          'Meta credentials missing — set META_WHATSAPP_PHONE_NUMBER_ID + META_WHATSAPP_ACCESS_TOKEN.',
        retryable: false,
        provider: 'meta',
      });
    }

    const template = await db.whatsAppTemplate.findUnique({
      where: { name_language: { name: params.name, language: params.language } },
    });
    if (
      !template?.metaTemplateName ||
      !template.active ||
      template.metaApprovalStatus !== 'APPROVED'
    ) {
      throw new TemplateNotConfiguredError({
        templateName: params.name,
        language: params.language,
        provider: 'meta',
      });
    }

    const body = {
      messaging_product: 'whatsapp',
      to: this.toMetaRecipient(params.recipientPhone),
      type: 'template',
      template: {
        name: template.metaTemplateName,
        language: { code: languageCode(params.language) },
        components:
          params.parameters.length > 0
            ? [
                {
                  type: 'body',
                  parameters: params.parameters.map((value) => ({
                    type: 'text',
                    text: value,
                  })),
                },
              ]
            : [],
      },
    };

    return this.post(body);
  }

  async sendText(params: SendTextParams): Promise<SendResult> {
    if (!this.token || !this.phoneId) {
      throw new WhatsAppError({
        code: 'PROVIDER_AUTH',
        message: 'Meta credentials missing.',
        retryable: false,
        provider: 'meta',
      });
    }
    const body = {
      messaging_product: 'whatsapp',
      to: this.toMetaRecipient(params.recipientPhone),
      type: 'text',
      text: { body: params.body, preview_url: false },
    };
    return this.post(body);
  }

  private async post(body: unknown): Promise<SendResult> {
    let res;
    try {
      res = await this.fetchImpl(`${this.base}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-layer fetch rejection (DNS failure, abort, ECONNREFUSED…).
      throw new WhatsAppError({
        code: 'PROVIDER_NETWORK',
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        provider: 'meta',
      });
    }

    let payload: MetaSendResponse;
    try {
      payload = (await res.json()) as MetaSendResponse;
    } catch {
      payload = {};
    }

    if (!res.ok) {
      throw this.wrapHttpError(res.status, payload, res.headers);
    }

    const id = payload.messages?.[0]?.id ?? null;
    return { providerMessageId: id, status: 'SENT' };
  }

  private wrapHttpError(
    httpStatus: number,
    payload: MetaSendResponse,
    headers: { get(name: string): string | null },
  ): WhatsAppError {
    const err = payload.error;
    const message = err?.message ?? err?.error_data?.details ?? `Meta HTTP ${httpStatus}`;
    const code = err?.code;
    const subcode = err?.error_subcode;
    const providerCode = code != null ? code : `HTTP_${httpStatus}`;

    if (isTerminalMetaCode(code)) {
      if (code === 131047) {
        return new WhatsAppError({
          code: 'NOT_IN_24H_WINDOW',
          message,
          retryable: false,
          provider: 'meta',
          providerCode,
        });
      }
      if (code === 131026 || subcode === 2018278) {
        return new WhatsAppError({
          code: 'RECIPIENT_OPTED_OUT',
          message,
          retryable: false,
          provider: 'meta',
          providerCode,
        });
      }
      if (code != null && code >= 132000 && code < 133000) {
        return new WhatsAppError({
          code: 'TEMPLATE_NOT_APPROVED',
          message,
          retryable: false,
          provider: 'meta',
          providerCode,
        });
      }
      return new WhatsAppError({
        code: 'INVALID_RECIPIENT',
        message,
        retryable: false,
        provider: 'meta',
        providerCode,
      });
    }

    if (httpStatus === 401 || httpStatus === 403) {
      return new WhatsAppError({
        code: 'PROVIDER_AUTH',
        message,
        retryable: false,
        provider: 'meta',
        providerCode,
      });
    }
    if (httpStatus === 429) {
      const retryAfter = headers.get('retry-after');
      const retryAfterMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : undefined;
      return new WhatsAppError({
        code: 'PROVIDER_RATE_LIMIT',
        message,
        retryable: true,
        provider: 'meta',
        providerCode,
        retryAfterMs,
      });
    }
    if (httpStatus >= 500 && httpStatus < 600) {
      return new WhatsAppError({
        code: 'PROVIDER_5XX',
        message,
        retryable: true,
        provider: 'meta',
        providerCode,
      });
    }
    return new WhatsAppError({
      code: 'PROVIDER_UNKNOWN',
      message,
      retryable: true,
      provider: 'meta',
      providerCode,
    });
  }

  private toMetaRecipient(phone: string): string {
    // Meta wants the bare international format without `+`.
    return phone.startsWith('+') ? phone.slice(1) : phone;
  }

  /**
   * Verify the X-Hub-Signature-256 header. Meta signs the raw request
   * body with HMAC-SHA256 using the WhatsApp Business App's app secret.
   * The header looks like `sha256=<hex>` — we compute the same and
   * timingSafeEqual against it.
   */
  verifyWebhook(args: { rawBody: string; signature: string; url?: string }): boolean {
    if (!this.appSecret || !args.signature) return false;
    if (!args.signature.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', this.appSecret)
      .update(args.rawBody, 'utf8')
      .digest('hex');
    const received = args.signature.slice('sha256='.length);
    // timingSafeEqual throws if lengths differ — guard explicitly.
    if (expected.length !== received.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
    } catch {
      return false;
    }
  }

  parseWebhook(rawBody: string): WebhookEvent[] {
    let payload: MetaWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as MetaWebhookPayload;
    } catch {
      return [];
    }
    const events: WebhookEvent[] = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        for (const m of value.messages ?? []) {
          const inbound: InboundMessage = {
            providerMessageId: m.id,
            fromPhone: normalizeMetaPhone(m.from),
            body: extractMessageBody(m),
            receivedAt: m.timestamp
              ? new Date(Number.parseInt(m.timestamp, 10) * 1000)
              : new Date(),
          };
          events.push({ kind: 'inbound', message: inbound });
        }
        for (const s of value.statuses ?? []) {
          const mapped = metaStatusFromString(s.status);
          if (!mapped) continue;
          const status: DeliveryStatusEvent = {
            providerMessageId: s.id,
            status: mapped,
            occurredAt: s.timestamp
              ? new Date(Number.parseInt(s.timestamp, 10) * 1000)
              : new Date(),
          };
          if (mapped === 'FAILED' && s.errors && s.errors.length > 0) {
            const e = s.errors[0]!;
            status.failureReason = [e.code != null && `[${e.code}]`, e.title, e.message]
              .filter(Boolean)
              .join(' ');
          }
          events.push({ kind: 'status', status });
        }
      }
    }
    return events;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.token || !this.phoneId) return false;
    try {
      const res = await this.fetchImpl(this.base, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.token}` },
      });
      return res.ok;
    } catch (err) {
      console.warn(`[whatsapp.meta] health check failed: ${describeWhatsAppError(err)}`);
      return false;
    }
  }
}

function extractMessageBody(m: MetaInboundMessageRaw): string {
  if (m.text?.body) return m.text.body;
  if (m.button?.text) return m.button.text;
  if (m.interactive?.button_reply?.title) return m.interactive.button_reply.title;
  if (m.interactive?.list_reply?.title) return m.interactive.list_reply.title;
  return '';
}
