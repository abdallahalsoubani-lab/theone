import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

/**
 * P52 — the combined new-patient confirmation template pack. One message the
 * new patient receives: their appointment date + time + a personal, single-
 * use intake link. Twilio Content Templates created in the owner's console;
 * the apply script verifies each SID against the live Content API before
 * writing (chat is never the source of truth — mismatch → STOP), mirroring
 * the arrival-template pattern.
 *
 * Variables (both languages): {{1}} patient name · {{2}} date · {{3}} time ·
 * {{4}} the personal intake URL.
 *
 * ⚠️ Approval note (for the report): at authoring time both SIDs show
 * "WhatsApp user initiated" ✅ but "WhatsApp business initiated" is NOT yet
 * green in Twilio. Business-initiated is what this feature needs. The code
 * ships wired up; sending begins working the moment approval lands — no
 * further deploy required.
 */
export const NEW_PATIENT_TEMPLATE_NAME = 'new_patient_confirmation';
export const NEW_PATIENT_SHAPE = ['patientName', 'date', 'time', 'intakeUrl'] as const;

export interface NewPatientTemplateEntry {
  language: LanguagePref;
  consoleName: string;
  /** Expected SID — verified against the live console before apply. */
  expectedSid: string;
  contentPreview: string;
}

export const NEW_PATIENT_TEMPLATES: readonly NewPatientTemplateEntry[] = [
  {
    language: 'EN',
    consoleName: 'new_patient_confirmation_en',
    expectedSid: 'HXb81dd59693d686f66737764c28b74667',
    contentPreview:
      'Hello {{1}}, your appointment is booked for {{2}} at {{3}}. Please complete your intake form here: {{4}}',
  },
  {
    language: 'AR',
    consoleName: 'new_patient_confirmation_ar',
    expectedSid: 'HX456b7ce60ba1ae2ac8ce3af434bbcd28',
    contentPreview:
      'مرحباً {{1}}، تم حجز موعدك يوم {{2}} الساعة {{3}}. يرجى تعبئة نموذج بياناتك من هنا: {{4}}',
  },
];

const SID_RE = /^HX[0-9a-f]{32}$/i;

/**
 * Upsert one new-patient-template registry row, audited with the system
 * actor. Idempotent: a re-run over an already-converged row is a no-op.
 */
export async function applyNewPatientTemplate(
  entry: NewPatientTemplateEntry,
  prisma: typeof db = db,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  if (!SID_RE.test(entry.expectedSid)) {
    throw new Error(`invalid SID for ${entry.consoleName}: ${entry.expectedSid}`);
  }
  const row = await prisma.whatsAppTemplate.findUnique({
    where: { name_language: { name: NEW_PATIENT_TEMPLATE_NAME, language: entry.language } },
    select: { id: true, twilioContentSid: true, variablesShape: true, contentPreview: true },
  });

  if (row) {
    const converged =
      row.twilioContentSid === entry.expectedSid &&
      JSON.stringify(row.variablesShape) === JSON.stringify([...NEW_PATIENT_SHAPE]) &&
      row.contentPreview === entry.contentPreview;
    if (converged) return { id: row.id, created: false, changed: false };
    await prisma.whatsAppTemplate.update({
      where: { id: row.id },
      data: {
        twilioContentSid: entry.expectedSid,
        twilioApproved: true,
        variablesShape: [...NEW_PATIENT_SHAPE],
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
          event: 'NEW_PATIENT_TEMPLATE_APPLIED',
          twilioContentSid: entry.expectedSid,
          variablesShape: [...NEW_PATIENT_SHAPE],
          consoleName: entry.consoleName,
        },
      },
    });
    return { id: row.id, created: false, changed: true };
  }

  const created = await prisma.whatsAppTemplate.create({
    data: {
      name: NEW_PATIENT_TEMPLATE_NAME,
      language: entry.language,
      category: 'APPOINTMENT',
      contentPreview: entry.contentPreview,
      active: true,
      variablesShape: [...NEW_PATIENT_SHAPE],
      metaTemplateName: entry.consoleName,
      metaApprovalStatus: 'NOT_SUBMITTED',
      twilioContentSid: entry.expectedSid,
      twilioApproved: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: SYSTEM_USER_ID,
      entityType: 'WhatsAppTemplate',
      entityId: created.id,
      action: 'CREATE',
      after: {
        event: 'NEW_PATIENT_TEMPLATE_CREATED',
        twilioContentSid: entry.expectedSid,
        variablesShape: [...NEW_PATIENT_SHAPE],
        consoleName: entry.consoleName,
      },
    },
  });
  return { id: created.id, created: true, changed: true };
}
