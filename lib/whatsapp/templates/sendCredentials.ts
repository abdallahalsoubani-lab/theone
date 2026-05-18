import type { LanguagePref } from '@prisma/client';

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
}

/**
 * Enqueue the patient_account_credentials WhatsApp template for a newly
 * created patient. The template signature matches the seed entry from
 * Prompt 2:
 *
 *   "Welcome to Theone.pt. Login: {{1}}, temporary password: {{2}}.
 *    Please change it on first sign-in."
 *
 * Parameter order is locked here so changing the template body in Meta
 * requires a coordinated update on this side. The send goes through the
 * outbound queue — call sites get a job id back rather than the
 * provider's send result. Failure handling (retries, the FAILED row,
 * whatsappReachable flips) lives uniformly in the outbound worker; the
 * patient registration flow keeps the row and surfaces a yellow banner
 * per Prompt 6 §4.1 if delivery later fails.
 */
export async function sendPatientCredentials(
  params: SendCredentialsParams,
): Promise<SendCredentialsResult> {
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
