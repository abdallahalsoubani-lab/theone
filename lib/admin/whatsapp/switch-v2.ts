import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

/**
 * P54 — the approved-v2 switch catalog for the FOUR templates moving to
 * the buttons + day-name shape (approved Jul 26; owner-confirmed scope:
 * confirmation + cancellation stay on their current templates).
 *
 * SIDs here are the owner's console capture — the SCRIPT verifies each one
 * against the LIVE Twilio Content API before applying (chat/screenshot is
 * never the source of truth; mismatch → STOP).
 *
 * Bodies are the exact approved texts recorded at submission in
 * docs/whatsapp-twilio-templates.md (R1/R2/R5/R6).
 */

export const V2_SHAPE = ['patientName', 'dayName', 'date', 'time'] as const;

export interface V2SwitchEntry {
  /** Registry logical name (the code-facing identifier — unchanged). */
  logicalName: string;
  language: LanguagePref;
  /** The NEW Twilio console content name. */
  consoleName: string;
  /** Expected SID — verified against the live console before apply. */
  expectedSid: string;
  /** The exact approved v2 body. */
  contentPreview: string;
}

export const V2_SWITCH: readonly V2SwitchEntry[] = [
  {
    logicalName: 'appointment_reminder_v2',
    language: 'AR',
    consoleName: 'appointment_reminder_ar_v2',
    expectedSid: 'HX02b49c81870548566f36e7ed8098a2a7',
    contentPreview:
      'مرحباً {{1}}، نذكّركم بموعدكم يوم {{2}} الموافق {{3}} الساعة {{4}}.\n' +
      'يرجى تأكيد الحضور بالضغط على أحد الخيارين أدناه، وفي حال الرغبة بتعديل أو إلغاء الموعد نرجو إبلاغنا قبل 24 ساعة.\n' +
      'في حال عدم الرد سيتم إلغاء الموعد.',
  },
  {
    logicalName: 'appointment_reminder_v2',
    language: 'EN',
    consoleName: 'appointment_reminder_en_v2',
    expectedSid: 'HX4b24dd64258fab707fc11064ac0c924f',
    contentPreview:
      'Hello {{1}}, this is a reminder of your appointment on {{2}}, {{3}} at {{4}}.\n' +
      'Please confirm by tapping an option below. To change or cancel, let us know at least 24 hours in advance.\n' +
      'If we receive no reply, the appointment will be cancelled.',
  },
  {
    logicalName: 'appointment_rescheduled',
    language: 'AR',
    consoleName: 'appointment_rescheduled_ar_v2',
    expectedSid: 'HX1e5ba22c339939e18078a347b233ab33',
    contentPreview:
      'مرحباً {{1}}، تم تغيير موعدكم إلى يوم {{2}} الموافق {{3}} الساعة {{4}}. نراكم قريباً.',
  },
  {
    logicalName: 'appointment_rescheduled',
    language: 'EN',
    consoleName: 'appointment_rescheduled_en_v2',
    expectedSid: 'HX1cbc7dee0d05ce76c9223f4cd367fc16',
    contentPreview:
      'Hi {{1}}, your appointment has been moved to {{2}}, {{3}} at {{4}}. See you then.',
  },
];

const SID_RE = /^HX[0-9a-f]{32}$/i;

/**
 * Apply one v2 switch through the SAME validation rules the 48b admin
 * action enforces (loud shape-token + SID checks), updating SID + shape +
 * contentPreview + console name in one audited step.
 *
 * Audit: the session-gated admin action cannot run headless, so the script
 * writes the explicit system-actor audit row (the P52 importer pattern) —
 * one UPDATE entry per switched row with before/after SIDs.
 */
export async function applyV2Switch(
  entry: V2SwitchEntry,
  prisma: typeof db = db,
): Promise<{ id: string; previousSid: string | null; changed: boolean }> {
  if (!SID_RE.test(entry.expectedSid)) {
    throw new Error(`invalid SID for ${entry.consoleName}: ${entry.expectedSid}`);
  }
  const row = await prisma.whatsAppTemplate.findUnique({
    where: { name_language: { name: entry.logicalName, language: entry.language } },
    select: { id: true, twilioContentSid: true, variablesShape: true, contentPreview: true },
  });
  if (!row) throw new Error(`registry row missing: ${entry.logicalName}/${entry.language}`);

  const shapeMatches =
    JSON.stringify(row.variablesShape) === JSON.stringify([...V2_SHAPE]) &&
    row.twilioContentSid === entry.expectedSid &&
    row.contentPreview === entry.contentPreview;
  if (shapeMatches) {
    return { id: row.id, previousSid: row.twilioContentSid, changed: false };
  }

  await prisma.whatsAppTemplate.update({
    where: { id: row.id },
    data: {
      twilioContentSid: entry.expectedSid,
      twilioApproved: true,
      variablesShape: [...V2_SHAPE],
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
        event: 'TEMPLATE_V2_SWITCH',
        twilioContentSid: entry.expectedSid,
        variablesShape: [...V2_SHAPE],
        consoleName: entry.consoleName,
      },
    },
  });
  return { id: row.id, previousSid: row.twilioContentSid, changed: true };
}
