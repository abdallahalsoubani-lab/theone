import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

/**
 * P64 #2 + #3 — the confirm / decline BUTTON templates.
 *
 * Owner ask: the booking confirmation AND the reminder must both carry the
 * two quick-reply buttons, and the reminder must name the appointment's DAY
 * (the approved v3 reminder bodies hard-code «غداً»). Two logical templates ×
 * two languages, each body = `{{1}}` patient first name + `{{2}}` the "when"
 * phrase («يوم السبت 14 نوفمبر الساعة 10:00 ص»), plus the SAME button ids the
 * v2 reminder used (`confirm` / `decline`) so the inbound parser
 * (lib/whatsapp/inbound/parser.ts) needs no change.
 *
 * Lifecycle (no deploy at switch time):
 *   1. `scripts/create-button-templates.ts --apply` creates the Twilio Content
 *      rows, submits them for WhatsApp approval (UTILITY) and registers the DB
 *      rows with `twilioApproved=false`;
 *   2. the hourly approval sync (`syncTemplateApproval`) also checks every DB
 *      row named here, so the flag flips the moment WhatsApp approves;
 *   3. the send paths prefer these templates as soon as they are approved
 *      (reminderBuilder.ts / sendConfirmation.ts) — until then the reminder
 *      rides the approved custom-message frame (day-correct, no buttons) and
 *      the confirmation keeps its current approved template.
 */

export const REMINDER_BUTTONS_TEMPLATE = 'appointment_reminder_v4';
export const CONFIRMATION_BUTTONS_TEMPLATE = 'appointment_confirmation_v4';
export const BUTTON_TEMPLATE_NAMES = [REMINDER_BUTTONS_TEMPLATE, CONFIRMATION_BUTTONS_TEMPLATE];

/** Body variables, in order: {{1}} first name, {{2}} the when-phrase. */
export const BUTTON_TEMPLATE_SHAPE = ['patientName', 'appointmentWhen'] as const;

export interface ButtonTemplateSpec {
  name: typeof REMINDER_BUTTONS_TEMPLATE | typeof CONFIRMATION_BUTTONS_TEMPLATE;
  language: LanguagePref;
  /** Twilio friendly name (= the Meta template name — lowercase + underscores). */
  friendlyName: string;
  body: string;
  /** Sample values Twilio/Meta show the reviewer. */
  sample: { '1': string; '2': string };
  buttons: Array<{ id: 'confirm' | 'decline'; title: string }>;
}

const AR_BUTTONS = [
  { id: 'confirm', title: 'تأكيد الحضور' },
  { id: 'decline', title: 'لا أستطيع الحضور' },
] as const;
const EN_BUTTONS = [
  { id: 'confirm', title: 'Confirm' },
  { id: 'decline', title: "Can't make it" },
] as const;

export const BUTTON_TEMPLATES: readonly ButtonTemplateSpec[] = [
  {
    name: REMINDER_BUTTONS_TEMPLATE,
    language: 'AR',
    friendlyName: 'appointment_reminder_v4_ar',
    body: 'مرحباً {{1}}، نذكّركم بموعدكم في المركز الأول للعلاج الطبيعي {{2}}. يرجى تأكيد حضوركم.',
    sample: { '1': 'سارة', '2': 'يوم السبت 14 نوفمبر الساعة 10:00 ص' },
    buttons: [...AR_BUTTONS],
  },
  {
    name: REMINDER_BUTTONS_TEMPLATE,
    language: 'EN',
    friendlyName: 'appointment_reminder_v4_en',
    body: 'Hello {{1}}, a reminder of your appointment at The One Physiotherapy Center {{2}}. Please confirm your attendance.',
    sample: { '1': 'Sara', '2': 'on Saturday 14 November at 10:00 AM' },
    buttons: [...EN_BUTTONS],
  },
  {
    name: CONFIRMATION_BUTTONS_TEMPLATE,
    language: 'AR',
    friendlyName: 'appointment_confirmation_v4_ar',
    body: 'مرحباً {{1}}، تم حجز موعدكم في المركز الأول للعلاج الطبيعي {{2}}. يرجى تأكيد حضوركم.',
    sample: { '1': 'سارة', '2': 'يوم السبت 14 نوفمبر الساعة 10:00 ص' },
    buttons: [...AR_BUTTONS],
  },
  {
    name: CONFIRMATION_BUTTONS_TEMPLATE,
    language: 'EN',
    friendlyName: 'appointment_confirmation_v4_en',
    body: 'Hello {{1}}, your appointment at The One Physiotherapy Center is booked {{2}}. Please confirm your attendance.',
    sample: { '1': 'Sara', '2': 'on Saturday 14 November at 10:00 AM' },
    buttons: [...EN_BUTTONS],
  },
];

const SID_RE = /^HX[0-9a-f]{32}$/i;

/**
 * Register (upsert) one button-template row with its Twilio SID, audited with
 * the system actor. `twilioApproved` is ALWAYS reset to false here — approval
 * comes only from the live sync. Idempotent for an unchanged SID + body.
 */
export async function registerButtonTemplate(
  spec: ButtonTemplateSpec,
  sid: string,
  prisma: typeof db = db,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  if (!SID_RE.test(sid)) throw new Error(`invalid SID for ${spec.friendlyName}: ${sid}`);
  const shape = [...BUTTON_TEMPLATE_SHAPE];
  const row = await prisma.whatsAppTemplate.findUnique({
    where: { name_language: { name: spec.name, language: spec.language } },
    select: { id: true, twilioContentSid: true, contentPreview: true },
  });
  if (row) {
    if (row.twilioContentSid === sid && row.contentPreview === spec.body) {
      return { id: row.id, created: false, changed: false };
    }
    await prisma.whatsAppTemplate.update({
      where: { id: row.id },
      data: {
        twilioContentSid: sid,
        twilioApproved: false,
        variablesShape: shape,
        contentPreview: spec.body,
        metaTemplateName: spec.friendlyName,
        active: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: SYSTEM_USER_ID,
        entityType: 'WhatsAppTemplate',
        entityId: row.id,
        action: 'UPDATE',
        before: { twilioContentSid: row.twilioContentSid },
        after: { event: 'BUTTON_TEMPLATE_REGISTERED', twilioContentSid: sid, name: spec.name },
      },
    });
    return { id: row.id, created: false, changed: true };
  }
  const created = await prisma.whatsAppTemplate.create({
    data: {
      name: spec.name,
      language: spec.language,
      category: 'APPOINTMENT',
      contentPreview: spec.body,
      active: true,
      variablesShape: shape,
      metaTemplateName: spec.friendlyName,
      metaApprovalStatus: 'PENDING',
      twilioContentSid: sid,
      twilioApproved: false,
    },
    select: { id: true },
  });
  await prisma.auditLog.create({
    data: {
      actorId: SYSTEM_USER_ID,
      entityType: 'WhatsAppTemplate',
      entityId: created.id,
      action: 'CREATE',
      after: { event: 'BUTTON_TEMPLATE_REGISTERED', twilioContentSid: sid, name: spec.name },
    },
  });
  return { id: created.id, created: true, changed: true };
}
