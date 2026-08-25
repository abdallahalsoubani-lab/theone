import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * P52/P53 deploy — template approval gate + fallback selection.
 *
 * Business-initiated WhatsApp messages (reminders, confirmations) can only
 * use a WhatsApp-APPROVED template; sending a `pending` template fails at
 * WhatsApp. So the send paths ask here whether a template is live-approved
 * and fall back to the previous approved template until it is. The
 * `twilioApproved` column is the source of truth, kept fresh by the daily
 * approval-sync job (lib/whatsapp/templates/approvalSync.ts) + the apply
 * scripts — never a per-send API call.
 */
export async function isTemplateApproved(name: string, language: LanguagePref): Promise<boolean> {
  const row = await db.whatsAppTemplate.findUnique({
    where: { name_language: { name, language } },
    select: { twilioApproved: true },
  });
  return row?.twilioApproved ?? false;
}

/** The v3 one-per-day reminders are usable only when BOTH the single and the
 *  multi template are approved for the language — otherwise the whole
 *  reminder flow falls back to the old per-appointment v2 template. */
export async function reminderV3Approved(language: LanguagePref): Promise<boolean> {
  const rows = await db.whatsAppTemplate.findMany({
    where: {
      language,
      name: { in: ['appointment_reminder_single_v3', 'appointment_reminder_multi'] },
    },
    select: { name: true, twilioApproved: true },
  });
  const approved = new Set(rows.filter((r) => r.twilioApproved).map((r) => r.name));
  return (
    approved.has('appointment_reminder_single_v3') && approved.has('appointment_reminder_multi')
  );
}
