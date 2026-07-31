import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

/**
 * July 31 item 3 — the arrival-confirmation template pack (Twilio Content
 * Templates created + approved in the owner's console). Unlike the P54
 * switch (which updated existing rows), production has NO registry row for
 * this template yet, so the apply is an UPSERT: create the row where
 * missing, converge SID/shape/body where present.
 *
 * SIDs here are the owner's console capture — the SCRIPT verifies each one
 * against the LIVE Twilio Content API before applying (chat is never the
 * source of truth; mismatch → STOP).
 */

export const ARRIVAL_TEMPLATE_NAME = 'arrival_confirmation';
export const ARRIVAL_SHAPE = ['patientName'] as const;

export interface ArrivalTemplateEntry {
  language: LanguagePref;
  /** The Twilio console content name. */
  consoleName: string;
  /** Expected SID — verified against the live console before apply. */
  expectedSid: string;
  /** The exact approved body. */
  contentPreview: string;
}

export const ARRIVAL_TEMPLATES: readonly ArrivalTemplateEntry[] = [
  {
    language: 'AR',
    consoleName: 'arrival_confirmation_ar',
    expectedSid: 'HX46afd71b051d70eba25b858cb18fda96',
    contentPreview:
      'أهلاً {{1}}، تم تسجيل وصولك في المركز الأول للعلاج الطبيعي. نتمنى لك جلسة موفقة.',
  },
  {
    language: 'EN',
    consoleName: 'arrival_confirmation_en',
    expectedSid: 'HXc886a2ffcb7a711a63623cf91decacf9',
    contentPreview:
      'Hi {{1}}, your arrival at The One Physiotherapy Center has been registered. We wish you a great session.',
  },
];

const SID_RE = /^HX[0-9a-f]{32}$/i;

/**
 * Upsert one arrival-template registry row, audited with the system actor
 * (the P52 importer pattern — the script runs headless, no admin session).
 * Idempotent: a re-run over an already-converged row is a no-op with no
 * audit entry.
 */
export async function applyArrivalTemplate(
  entry: ArrivalTemplateEntry,
  prisma: typeof db = db,
): Promise<{ id: string; created: boolean; changed: boolean }> {
  if (!SID_RE.test(entry.expectedSid)) {
    throw new Error(`invalid SID for ${entry.consoleName}: ${entry.expectedSid}`);
  }
  const row = await prisma.whatsAppTemplate.findUnique({
    where: { name_language: { name: ARRIVAL_TEMPLATE_NAME, language: entry.language } },
    select: { id: true, twilioContentSid: true, variablesShape: true, contentPreview: true },
  });

  if (row) {
    const converged =
      row.twilioContentSid === entry.expectedSid &&
      JSON.stringify(row.variablesShape) === JSON.stringify([...ARRIVAL_SHAPE]) &&
      row.contentPreview === entry.contentPreview;
    if (converged) return { id: row.id, created: false, changed: false };

    await prisma.whatsAppTemplate.update({
      where: { id: row.id },
      data: {
        twilioContentSid: entry.expectedSid,
        twilioApproved: true,
        variablesShape: [...ARRIVAL_SHAPE],
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
          event: 'ARRIVAL_TEMPLATE_APPLIED',
          twilioContentSid: entry.expectedSid,
          variablesShape: [...ARRIVAL_SHAPE],
          consoleName: entry.consoleName,
        },
      },
    });
    return { id: row.id, created: false, changed: true };
  }

  const created = await prisma.whatsAppTemplate.create({
    data: {
      name: ARRIVAL_TEMPLATE_NAME,
      language: entry.language,
      category: 'APPOINTMENT',
      contentPreview: entry.contentPreview,
      active: true,
      variablesShape: [...ARRIVAL_SHAPE],
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
        event: 'ARRIVAL_TEMPLATE_CREATED',
        twilioContentSid: entry.expectedSid,
        variablesShape: [...ARRIVAL_SHAPE],
        consoleName: entry.consoleName,
      },
    },
  });
  return { id: created.id, created: true, changed: true };
}
