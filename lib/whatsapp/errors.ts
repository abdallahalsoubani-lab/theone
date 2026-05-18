/**
 * Typed error classes raised by the WhatsApp providers and webhook layer.
 *
 * Two design rules:
 *
 * 1. Every error has a `code` discriminator that survives JSON serialization
 *    and that the outbound queue worker uses to decide retryable vs. terminal.
 *    Network blips and 5xx → retryable. Invalid phone / template not approved
 *    / signature mismatch → terminal.
 *
 * 2. Errors carry the original provider payload (where safe). Twilio errors
 *    include a numeric `code` (e.g., 21211 = "invalid To phone"); Meta errors
 *    include an `error.code` + `error.subcode`. We surface both so the Admin
 *    message log can render a meaningful failure reason.
 */

export type WhatsAppErrorCode =
  | 'TEMPLATE_NOT_CONFIGURED'
  | 'TEMPLATE_NOT_APPROVED'
  | 'INVALID_RECIPIENT'
  | 'RECIPIENT_OPTED_OUT'
  | 'NOT_IN_24H_WINDOW'
  | 'PROVIDER_RATE_LIMIT'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_5XX'
  | 'PROVIDER_NETWORK'
  | 'PROVIDER_UNKNOWN'
  | 'INVALID_SIGNATURE'
  | 'WEBHOOK_PARSE'
  | 'NOT_IMPLEMENTED';

/**
 * Base class. `retryable` is the only field the outbound worker reads from
 * the catch site — every subclass sets it explicitly so the decision can't
 * silently drift.
 */
export class WhatsAppError extends Error {
  readonly code: WhatsAppErrorCode;
  readonly retryable: boolean;
  readonly provider: 'twilio' | 'meta' | 'console' | 'unknown';
  readonly providerCode?: string | number;
  readonly retryAfterMs?: number;

  constructor(args: {
    code: WhatsAppErrorCode;
    message: string;
    retryable: boolean;
    provider?: WhatsAppError['provider'];
    providerCode?: string | number;
    retryAfterMs?: number;
  }) {
    super(args.message);
    this.name = 'WhatsAppError';
    this.code = args.code;
    this.retryable = args.retryable;
    this.provider = args.provider ?? 'unknown';
    this.providerCode = args.providerCode;
    this.retryAfterMs = args.retryAfterMs;
  }
}

export class TemplateNotConfiguredError extends WhatsAppError {
  constructor(args: { templateName: string; language: string; provider: 'twilio' | 'meta' }) {
    super({
      code: args.provider === 'meta' ? 'TEMPLATE_NOT_APPROVED' : 'TEMPLATE_NOT_CONFIGURED',
      message:
        `Template "${args.templateName}" (${args.language}) is not configured for ` +
        `provider=${args.provider}. Configure it in /admin/whatsapp/templates.`,
      retryable: false,
      provider: args.provider,
    });
    this.name = 'TemplateNotConfiguredError';
  }
}

export class InvalidWebhookSignatureError extends WhatsAppError {
  constructor(provider: 'twilio' | 'meta') {
    super({
      code: 'INVALID_SIGNATURE',
      message: `Webhook signature verification failed for provider=${provider}.`,
      retryable: false,
      provider,
    });
    this.name = 'InvalidWebhookSignatureError';
  }
}

/**
 * Used by the stub provider entries while a real implementation is being
 * built. Treated as terminal at the worker — no retry would help.
 */
export class WhatsAppNotImplementedError extends WhatsAppError {
  constructor(message: string) {
    super({ code: 'NOT_IMPLEMENTED', message, retryable: false });
    this.name = 'WhatsAppNotImplementedError';
  }
}

/**
 * Render a single-line human-readable failure reason from any thrown error.
 * Stored on `WhatsAppMessage.failureReason` and shown to the Secretary on
 * the patient profile reachability section. Never includes the bearer token
 * or other secrets — both providers' SDKs sometimes embed the URL in the
 * error message, so we strip query strings defensively.
 */
export function describeWhatsAppError(err: unknown): string {
  if (err instanceof WhatsAppError) {
    const tag = err.providerCode != null ? ` [${err.providerCode}]` : '';
    return `${err.code}${tag}: ${stripSecrets(err.message)}`;
  }
  if (err instanceof Error) return stripSecrets(err.message);
  return 'Unknown error';
}

function stripSecrets(message: string): string {
  return message
    .replace(/(Bearer\s+)[\w.-]+/gi, '$1<redacted>')
    .replace(/(access_token=)[\w.-]+/gi, '$1<redacted>')
    .replace(/(AuthToken=)[\w.-]+/gi, '$1<redacted>');
}
