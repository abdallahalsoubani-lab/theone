import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

/**
 * P60 — the manual "custom message" frame. The secretary's free text can
 * only reach a patient business-initiated inside an APPROVED template, so
 * the owner registered a two-variable frame in the Twilio console:
 *   {{1}} patient first name (per language, same helper the arrival
 *         template uses) · {{2}} the secretary's text (normalized to the
 *         WhatsApp parameter rules — see lib/whatsapp/manual/customText.ts).
 *
 * Registered the P56 way: the apply script verifies each SID against the
 * live Content API before writing; `twilioApproved` starts FALSE and is
 * flipped ONLY by the hourly approval sync (the row is in
 * APPROVAL_TRACKED), so the panel hides the "custom message" type until
 * WhatsApp approves the frame — no deploy needed when approval lands.
 */
export const CUSTOM_MESSAGE_TEMPLATE_NAME = 'clinic_custom_message';
export const CUSTOM_MESSAGE_SHAPE = ['patientName', 'customText'] as const;

export interface CustomMessageTemplateEntry {
  language: LanguagePref;
  consoleName: string;
  /** Expected SID — verified against the live console before apply. */
  expectedSid: string;
  contentPreview: string;
}

export const CUSTOM_MESSAGE_TEMPLATES: readonly CustomMessageTemplateEntry[] = [
  {
    language: 'AR',
    consoleName: 'clinic_custom_message_ar',
    expectedSid: 'HX318759369c2b8d4c72adb0bfe9b812ff',
    contentPreview:
      'مرحباً {{1}}،\nرسالة من المركز الأول للعلاج الطبيعي:\n\n{{2}}\n\nللاستفسار يمكنكم الرد على هذه الرسالة أو الاتصال بالمركز.',
  },
  {
    language: 'EN',
    consoleName: 'clinic_custom_message_en',
    expectedSid: 'HXa9c5ef16883cba246d296c947e2f9e98',
    contentPreview:
      'Hello {{1}},\nA message from The One for Physiotherapy:\n\n{{2}}\n\nFor any questions, you can reply to this message or call the clinic.',
  },
];

const SID_RE = /^HX[0-9a-f]{32}$/i;

/**
 * Upsert one custom-message registry row, audited with the system actor.
 * Idempotent: a re-run over an already-converged row is a no-op.
 */
export async function applyCustomMessageTemplate(
  entry: CustomMessageTemplateEntry,
  prisma: typeof db = db,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  if (!SID_RE.test(entry.expectedSid)) {
    throw new Error(`invalid SID for ${entry.consoleName}: ${entry.expectedSid}`);
  }
  const row = await prisma.whatsAppTemplate.findUnique({
    where: { name_language: { name: CUSTOM_MESSAGE_TEMPLATE_NAME, language: entry.language } },
    select: { id: true, twilioContentSid: true, variablesShape: true, contentPreview: true },
  });

  if (row) {
    const converged =
      row.twilioContentSid === entry.expectedSid &&
      JSON.stringify(row.variablesShape) === JSON.stringify([...CUSTOM_MESSAGE_SHAPE]) &&
      row.contentPreview === entry.contentPreview;
    if (converged) return { id: row.id, created: false, changed: false };
    await prisma.whatsAppTemplate.update({
      where: { id: row.id },
      data: {
        twilioContentSid: entry.expectedSid,
        twilioApproved: false, // approval comes ONLY from the live sync
        variablesShape: [...CUSTOM_MESSAGE_SHAPE],
        contentPreview: entry.contentPreview,
        metaTemplateName: entry.consoleName,
        active: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: SYSTEM_USER_ID,
        entityType: 'WhatsAppTemplate',
        entityId: row.id,
        action: 'UPDATE',
        before: { twilioContentSid: row.twilioContentSid, variablesShape: row.variablesShape },
        after: {
          event: 'CUSTOM_MESSAGE_TEMPLATE_APPLIED',
          twilioContentSid: entry.expectedSid,
          variablesShape: [...CUSTOM_MESSAGE_SHAPE],
          consoleName: entry.consoleName,
        },
      },
    });
    return { id: row.id, created: false, changed: true };
  }

  const created = await prisma.whatsAppTemplate.create({
    data: {
      name: CUSTOM_MESSAGE_TEMPLATE_NAME,
      language: entry.language,
      category: 'APPOINTMENT',
      contentPreview: entry.contentPreview,
      active: true,
      variablesShape: [...CUSTOM_MESSAGE_SHAPE],
      metaTemplateName: entry.consoleName,
      metaApprovalStatus: 'NOT_SUBMITTED',
      twilioContentSid: entry.expectedSid,
      twilioApproved: false, // approval comes ONLY from the live sync
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: SYSTEM_USER_ID,
      entityType: 'WhatsAppTemplate',
      entityId: created.id,
      action: 'CREATE',
      after: {
        event: 'CUSTOM_MESSAGE_TEMPLATE_CREATED',
        twilioContentSid: entry.expectedSid,
        variablesShape: [...CUSTOM_MESSAGE_SHAPE],
        consoleName: entry.consoleName,
      },
    },
  });
  return { id: created.id, created: true, changed: true };
}
