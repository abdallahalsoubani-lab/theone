import type { LanguagePref } from '@prisma/client';

/**
 * WhatsApp provider abstraction — the interface every clinic-side delivery
 * channel implements. This file is the contract; concrete implementations
 * live in `./console.ts` (dev) and `./meta.ts` / `./twilio.ts` (production —
 * arriving in Prompt 8). Application code imports from `./index.ts` which
 * resolves the active implementation from `process.env.WHATSAPP_PROVIDER`.
 *
 * Designed so swapping Twilio for Meta in Prompt 8 touches one file.
 *
 * The OTP-specific sender (lib/auth/senders/) stays alongside this for the
 * narrow phone-OTP path used by the patient login flow. This module covers
 * everything else — proactive template sends, free-form text inside a 24h
 * conversation, webhook parsing.
 */

export interface SendTemplateParams {
  /** The Meta-approved template name registered in the WABA. */
  name: string;
  recipientPhone: string;
  /** Locale-specific variant. Templates are registered once per language. */
  language: LanguagePref;
  /**
   * Numbered placeholder substitutions matching the template body, e.g.
   * `{{1}}` → parameters[0]. Order matters; this mirrors Meta's request shape.
   */
  parameters: ReadonlyArray<string>;
  /** Optional recipient id for audit + delivery-log row writes (Prompt 8). */
  recipientUserId?: string | null;
}

export interface SendTextParams {
  recipientPhone: string;
  body: string;
  recipientUserId?: string | null;
}

export interface SendResult {
  /** Provider-side message id, used for delivery-status webhooks. */
  providerMessageId: string | null;
  status: 'SENT' | 'QUEUED' | 'FAILED';
  /** Set when status === 'FAILED' so callers can log without re-throwing. */
  failureReason?: string;
}

export interface WhatsAppProvider {
  readonly id: 'console' | 'twilio' | 'meta';
  sendTemplate(params: SendTemplateParams): Promise<SendResult>;
  sendText(params: SendTextParams): Promise<SendResult>;
}

export class WhatsAppNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppNotImplementedError';
  }
}
