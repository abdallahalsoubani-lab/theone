import type { LanguagePref } from '@prisma/client';

/**
 * WhatsApp provider abstraction — the interface every clinic-side delivery
 * channel implements. This file is the contract; concrete implementations
 * live in `./providers/console.ts` (dev), `./providers/twilio.ts` (sandbox
 * + Twilio production), and `./providers/meta.ts` (Meta Cloud API for
 * production at scale). The factory in `./index.ts` resolves the active
 * implementation from `process.env.WHATSAPP_PROVIDER`.
 *
 * Designed so swapping Twilio for Meta is a one-env-var change. If you find
 * yourself branching on `provider.id` at a call site, that logic belongs
 * inside the provider implementation, not at the call site.
 */

export interface SendTemplateParams {
  /** The logical template name registered in WhatsAppTemplate.name. */
  name: string;
  recipientPhone: string;
  /** Locale-specific variant. Templates are registered once per language. */
  language: LanguagePref;
  /**
   * Numbered placeholder substitutions matching the template body, e.g.
   * `{{1}}` → parameters[0]. Order matters; the provider maps this to its
   * own request shape (Twilio JSON string of `{ "1": "...", "2": "..." }`,
   * Meta array of `{ type: 'text', text: '...' }`).
   */
  parameters: ReadonlyArray<string>;
  /** Optional recipient id used by the outbound queue for delivery-log writes. */
  recipientUserId?: string | null;
  /** Optional linked appointment — set when the message concerns a specific booking. */
  appointmentId?: string | null;
}

export interface SendTextParams {
  recipientPhone: string;
  body: string;
  recipientUserId?: string | null;
  appointmentId?: string | null;
}

export interface SendResult {
  /** Provider-side message id, used for delivery-status webhooks. */
  providerMessageId: string | null;
  status: 'SENT' | 'QUEUED' | 'FAILED';
  /** Set when status === 'FAILED' so callers can log without re-throwing. */
  failureReason?: string;
}

/**
 * Normalized inbound message shape. Twilio and Meta payloads are very
 * different on the wire; the parser methods on each provider map them to
 * this common shape so the inbound pipeline (parser + handler + inbox) is
 * provider-agnostic.
 */
export interface InboundMessage {
  providerMessageId: string;
  fromPhone: string;
  body: string;
  receivedAt: Date;
}

/**
 * Normalized delivery status event. Maps from Twilio's
 * `MessageStatus=queued|sending|delivered|read|failed|undelivered` and
 * from Meta's `statuses[].status=sent|delivered|read|failed`.
 */
export interface DeliveryStatusEvent {
  providerMessageId: string;
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  occurredAt: Date;
  failureReason?: string;
}

export type WebhookEvent =
  | { kind: 'inbound'; message: InboundMessage }
  | { kind: 'status'; status: DeliveryStatusEvent };

export interface WhatsAppProvider {
  readonly id: 'console' | 'twilio' | 'meta';
  sendTemplate(params: SendTemplateParams): Promise<SendResult>;
  sendText(params: SendTextParams): Promise<SendResult>;

  /**
   * Verify the inbound webhook signature. Returns true if the signature is
   * valid for the given body. Implementations MUST be timing-safe — never
   * use plain string equality on the HMAC.
   *
   * Twilio: validates `X-Twilio-Signature` over the full POST URL +
   *   sorted form fields. The webhook handler must pass the public URL it
   *   was reached at (Twilio computes the HMAC against that exact URL).
   * Meta: validates `X-Hub-Signature-256` HMAC-SHA256 of the raw body
   *   using the WhatsApp App Secret.
   * Console: always true (no signature surface).
   */
  verifyWebhook(args: { rawBody: string; signature: string; url: string }): boolean;

  /**
   * Parse a verified webhook payload into the normalized event shape.
   * Returns zero or more events — a single Meta payload can contain
   * multiple messages and multiple statuses interleaved. Implementations
   * MUST NOT throw on malformed payloads; instead return an empty array
   * and the webhook handler responds 200 so the provider stops retrying.
   */
  parseWebhook(rawBody: string): WebhookEvent[];

  /**
   * Lightweight self-check fired once at boot. Returns true on success.
   * Implementations MUST NOT throw — wrap their own errors and return
   * false so the app continues booting on transient failures.
   */
  healthCheck(): Promise<boolean>;
}

export { WhatsAppNotImplementedError } from './errors';
