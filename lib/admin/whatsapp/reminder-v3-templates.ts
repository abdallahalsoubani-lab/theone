import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

/**
 * P53 — the one-reminder-per-patient-per-day template pack. Two logical
 * templates × two languages (4 Twilio Content rows). Both carry a single
 * {{1}} body variable:
 *   - single_v3: the one appointment's start time;
 *   - multi:     the day-summary (adjacent runs as ranges, spaced as a list).
 * The old `appointment_reminder_v2` row stays in place but unused. Mirrors
 * the arrival-template apply pattern (live SID verification in the script).
 *
 * The approved copy contains NO "otherwise your appointment will be
 * cancelled" sentence (owner decision 7) and NO therapist name (decision 6).
 */
export const REMINDER_V3_SHAPE = ['reminderBody'] as const;

export interface ReminderV3Entry {
  templateName: 'appointment_reminder_single_v3' | 'appointment_reminder_multi';
  language: LanguagePref;
  consoleName: string;
  expectedSid: string;
  contentPreview: string;
}

export const REMINDER_V3_TEMPLATES: readonly ReminderV3Entry[] = [
  {
    templateName: 'appointment_reminder_multi',
    language: 'AR',
    consoleName: 'appointment_reminder_multi_ar',
    expectedSid: 'HX304661cf0c4e72f49a215675e1f1cdf8',
    contentPreview: 'مرحباً، نذكّركم بمواعيدكم غداً في المركز الأول للعلاج الطبيعي: {{1}}.',
  },
  {
    templateName: 'appointment_reminder_multi',
    language: 'EN',
    consoleName: 'appointment_reminder_multi_en',
    expectedSid: 'HX96350b9aaca08ce6aa5a38805be41a57',
    contentPreview:
      'Hello, a reminder of your appointments tomorrow at The One Physiotherapy Center: {{1}}.',
  },
  {
    templateName: 'appointment_reminder_single_v3',
    language: 'AR',
    consoleName: 'appointment_reminder_single_v3_ar',
    expectedSid: 'HXda84a7201b79d4a40413fd44637f6351',
    contentPreview: 'مرحباً، نذكّركم بموعدكم غداً في المركز الأول للعلاج الطبيعي الساعة {{1}}.',
  },
  {
    templateName: 'appointment_reminder_single_v3',
    language: 'EN',
    consoleName: 'appointment_reminder_single_v3_en',
    expectedSid: 'HXc575e03089cb18b3cd77c17eb83fb3ac',
    contentPreview:
      'Hello, a reminder of your appointment tomorrow at The One Physiotherapy Center at {{1}}.',
  },
];

const SID_RE = /^HX[0-9a-f]{32}$/i;

export async function applyReminderV3Template(
  entry: ReminderV3Entry,
  prisma: typeof db = db,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  if (!SID_RE.test(entry.expectedSid)) {
    throw new Error(`invalid SID for ${entry.consoleName}: ${entry.expectedSid}`);
  }
  const row = await prisma.whatsAppTemplate.findUnique({
    where: { name_language: { name: entry.templateName, language: entry.language } },
    select: { id: true, twilioContentSid: true, variablesShape: true, contentPreview: true },
  });

  if (row) {
    const converged =
      row.twilioContentSid === entry.expectedSid &&
      JSON.stringify(row.variablesShape) === JSON.stringify([...REMINDER_V3_SHAPE]) &&
      row.contentPreview === entry.contentPreview;
    if (converged) return { id: row.id, created: false, changed: false };
    await prisma.whatsAppTemplate.update({
      where: { id: row.id },
      data: {
        twilioContentSid: entry.expectedSid,
        twilioApproved: false, // P52/P53: approval comes ONLY from the live sync
        variablesShape: [...REMINDER_V3_SHAPE],
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
          event: 'REMINDER_V3_TEMPLATE_APPLIED',
          twilioContentSid: entry.expectedSid,
          consoleName: entry.consoleName,
        },
      },
    });
    return { id: row.id, created: false, changed: true };
  }

  const created = await prisma.whatsAppTemplate.create({
    data: {
      name: entry.templateName,
      language: entry.language,
      category: 'APPOINTMENT',
      contentPreview: entry.contentPreview,
      active: true,
      variablesShape: [...REMINDER_V3_SHAPE],
      metaTemplateName: entry.consoleName,
      metaApprovalStatus: 'NOT_SUBMITTED',
      twilioContentSid: entry.expectedSid,
      twilioApproved: false, // P52/P53: approval comes ONLY from the live sync
    },
  });
  await prisma.auditLog.create({
    data: {
      actorId: SYSTEM_USER_ID,
      entityType: 'WhatsAppTemplate',
      entityId: created.id,
      action: 'CREATE',
      after: {
        event: 'REMINDER_V3_TEMPLATE_CREATED',
        twilioContentSid: entry.expectedSid,
        consoleName: entry.consoleName,
      },
    },
  });
  return { id: created.id, created: true, changed: true };
}
