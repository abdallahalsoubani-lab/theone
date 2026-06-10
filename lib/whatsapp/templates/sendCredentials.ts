import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

const TEMPLATE_NAME = 'patient_account_credentials';

interface SendCredentialsParams {
  recipientUserId: string;
  recipientPhone: string;
  recipientName: string;
  username: string;
  tempPassword: string;
  portalUrl: string;
  language: LanguagePref;
}

export interface SendCredentialsResult {
  ok: true;
  jobId: string | null;
  /** True when the send was intentionally skipped (template disabled). */
  skipped?: boolean;
}

/**
 * Enqueue the patient_account_credentials WhatsApp template for a newly
 * created patient. Parameters: {{1}} = username, {{2}} = temporary password.
 *
 * Phase-two deferral: this template was rejected by Meta and is seeded
 * inactive. Before enqueuing we check the template exists and is active; if
 * not, we log a (PII-free) warning and skip — returning `skipped: true`
 * instead of throwing. That keeps patient account creation from emitting a
 * FAILED delivery row, an Inbox item, and a `whatsappReachable=false` flip on
 * every registration while the template is unavailable. Re-enabling is a
 * single `active` toggle once Meta approves a replacement.
 *
 * Parameter order is locked here so changing the template body in Meta
 * requires a coordinated update on this side. The send goes through the
 * outbound queue; failure handling (retries, the FAILED row, whatsappReachable
 * flips) lives uniformly in the outbound worker.
 */
export async function sendPatientCredentials(
  params: SendCredentialsParams,
): Promise<SendCredentialsResult> {
  const template = await db.whatsAppTemplate.findUnique({
    where: { name_language: { name: TEMPLATE_NAME, language: params.language } },
    select: { active: true },
  });

  if (!template || !template.active) {
    // No PII (no phone / name / password) — just the template + language.
    console.warn(
      `[whatsapp] skipping ${TEMPLATE_NAME} (${params.language}) send: template ${
        template ? 'inactive' : 'not configured'
      }`,
    );
    return { ok: true, jobId: null, skipped: true };
  }

  const jobId = await enqueueWhatsappOutbound({
    kind: 'template',
    templateName: TEMPLATE_NAME,
    language: params.language,
    parameters: [params.username, params.tempPassword],
    recipientPhone: params.recipientPhone,
    recipientUserId: params.recipientUserId,
    source: 'queue',
  });
  return { ok: true, jobId };
}
