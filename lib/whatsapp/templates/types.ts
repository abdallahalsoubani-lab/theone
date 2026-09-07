import type { LanguagePref } from '@prisma/client';

import type { WhatsappOutboundSource } from '@/lib/queue/jobs/whatsappOutbound';

/**
 * P60 — shared sender contracts. Every appointment sender is split into a
 * pure-ish `compose*` step (template + language + parameters for ONE
 * recipient, no side effects beyond reads) and a `send*` step that enqueues
 * the composed message. The manual "Send a message" panel renders its
 * preview from the SAME composition the send uses, so what the secretary
 * sees is byte-for-byte what leaves.
 */
export interface ComposedMessage {
  templateName: string;
  language: LanguagePref;
  parameters: string[];
  recipientPhone: string;
  recipientUserId: string | null;
  appointmentId: string | null;
}

/** What a sender reports back after enqueueing (null = skipped silently). */
export interface SendOutcome {
  jobId: string | null;
  templateName: string;
  language: LanguagePref;
  recipientUserId: string | null;
}

/** Passthrough options every sender accepts (P60): the job's source marker
 *  and the staff member behind a human-initiated send. */
export interface SenderSendOptions {
  source?: WhatsappOutboundSource;
  sentById?: string | null;
}
