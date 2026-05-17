import type { LanguagePref } from '@prisma/client';

import { whatsapp, type SendResult } from '@/lib/whatsapp';

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

/**
 * Send the patient_account_credentials WhatsApp template to a newly-created
 * patient. The template signature matches the seed entry from Prompt 2:
 *
 *   "Welcome to Theone.pt. Login: {{1}}, temporary password: {{2}}.
 *    Please change it on first sign-in."
 *
 * Parameter order is locked here so changing the template body in Meta
 * requires a coordinated update on this side. Failures are returned as
 * structured SendResult — callers decide whether to surface a warning to
 * the operator or roll back; the patient registration flow keeps the row
 * and surfaces a yellow banner per Prompt 6 §4.1.
 */
export async function sendPatientCredentials(params: SendCredentialsParams): Promise<SendResult> {
  return whatsapp.sendTemplate({
    name: TEMPLATE_NAME,
    recipientPhone: params.recipientPhone,
    language: params.language,
    parameters: [params.username, params.tempPassword],
    recipientUserId: params.recipientUserId,
  });
}
