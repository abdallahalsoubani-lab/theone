import type { LanguagePref } from '@prisma/client';

import { whatsappOutboundQueue } from '../queues';

/**
 * The single chokepoint for every outbound WhatsApp message.
 *
 * Why a queue? Two reasons:
 *   1. **Audit + observability.** Every outbound writes a WhatsAppMessage
 *      row regardless of provider success — call sites get a sync result
 *      via the queue, but failure handling (retries, reachability flips,
 *      inbox items) is uniform across reminders, OTP, credentials, and
 *      the manual /admin resend action.
 *   2. **Retry + rate limit.** BullMQ handles exponential backoff for
 *      transient failures; the worker's per-phone / global token bucket
 *      delays excess jobs rather than failing them.
 *
 * Resist the temptation to bypass for "quick" sends. The 24h-window
 * acknowledgement messages from the inbound parser go through here too.
 */

export type WhatsappOutboundKind = 'template' | 'text';

export interface WhatsappOutboundJob {
  kind: WhatsappOutboundKind;
  /** Logical template name; required when kind=template. */
  templateName?: string;
  /** Parameters bound to `{{1}}`, `{{2}}`, … in template order. */
  parameters?: ReadonlyArray<string>;
  /** Free-form body; required when kind=text. Used inside the 24h window. */
  body?: string;
  language: LanguagePref;
  recipientPhone: string;
  recipientUserId?: string | null;
  appointmentId?: string | null;
  /** Resend / source marker — surfaces in audit + admin UI. Defaults to 'queue'. */
  source?: 'queue' | 'resend' | 'inbound_ack';
  /** Optional handle so resends from the admin log can link back. */
  originatingMessageId?: string | null;
}

export interface EnqueueWhatsappOutboundArgs extends WhatsappOutboundJob {
  /** Optional delay (ms) — used by the reminder worker. */
  delayMs?: number;
  /** Optional override of BullMQ retry attempts. */
  attempts?: number;
}

export async function enqueueWhatsappOutbound(
  args: EnqueueWhatsappOutboundArgs,
): Promise<string | null> {
  const { delayMs, attempts, ...job } = args;
  const added = await whatsappOutboundQueue.add('outbound', job, {
    ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
    ...(attempts ? { attempts } : {}),
  });
  return added.id ?? null;
}
