import { AuditAction, type LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

/**
 * P52/P53 deploy — sync the LIVE WhatsApp approval status of the pending
 * templates into WhatsAppTemplate.twilioApproved, so the send paths flip
 * from the v2/standard fallback to the v3/combined templates AUTOMATICALLY
 * the moment WhatsApp approves them — no deploy. Runs daily (and once from
 * the apply scripts). A pending→approved flip is logged loudly and audited
 * so the exact switch moment is visible, not inferred from message changes.
 *
 * `fetchImpl` is injectable for tests.
 */

/** Logical name + language + Twilio content SID for the templates we track. */
export interface TrackedTemplate {
  name: string;
  language: LanguagePref;
  sid: string;
}

/** The templates whose approval gates a fallback (v3 reminders + combined
 *  new-patient confirmation). Keep in sync with the apply scripts' SIDs. */
export const APPROVAL_TRACKED: readonly TrackedTemplate[] = [
  {
    name: 'appointment_reminder_single_v3',
    language: 'AR',
    sid: 'HXda84a7201b79d4a40413fd44637f6351',
  },
  {
    name: 'appointment_reminder_single_v3',
    language: 'EN',
    sid: 'HXc575e03089cb18b3cd77c17eb83fb3ac',
  },
  { name: 'appointment_reminder_multi', language: 'AR', sid: 'HX304661cf0c4e72f49a215675e1f1cdf8' },
  { name: 'appointment_reminder_multi', language: 'EN', sid: 'HX96350b9aaca08ce6aa5a38805be41a57' },
  { name: 'new_patient_confirmation', language: 'AR', sid: 'HX456b7ce60ba1ae2ac8ce3af434bbcd28' },
  { name: 'new_patient_confirmation', language: 'EN', sid: 'HXb81dd59693d686f66737764c28b74667' },
];

function twilioAuthHeader(): string | null {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

/** Fetch one template's live WhatsApp approval status ('approved' | other). */
async function fetchApprovalStatus(
  sid: string,
  auth: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const res = await fetchImpl(`https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { whatsapp?: { status?: string } };
  return body.whatsapp?.status ?? null;
}

export interface ApprovalSyncResult {
  checked: number;
  approved: number;
  flipped: string[];
}

export async function syncTemplateApproval(
  tracked: readonly TrackedTemplate[] = APPROVAL_TRACKED,
  fetchImpl: typeof fetch = fetch,
): Promise<ApprovalSyncResult> {
  const auth = twilioAuthHeader();
  if (!auth) {
    console.warn('[templates] approval sync skipped — no Twilio credentials');
    return { checked: 0, approved: 0, flipped: [] };
  }

  const now = new Date();
  let approved = 0;
  const flipped: string[] = [];

  for (const t of tracked) {
    const status = await fetchApprovalStatus(t.sid, auth, fetchImpl).catch(() => null);
    if (status === null) continue; // transient — leave the flag as-is
    const isApproved = status === 'approved';
    if (isApproved) approved += 1;

    const existing = await db.whatsAppTemplate.findUnique({
      where: { name_language: { name: t.name, language: t.language } },
      select: { id: true, twilioApproved: true },
    });
    if (!existing) continue;

    const wasApproved = existing.twilioApproved;
    await db.whatsAppTemplate.update({
      where: { id: existing.id },
      data: { twilioApproved: isApproved, twilioApprovalCheckedAt: now },
    });

    // The switch moment — loud + audited.
    if (!wasApproved && isApproved) {
      const label = `${t.name}/${t.language}`;
      flipped.push(label);
      console.warn(`[templates] ${label} approved — switching`);
      await db.auditLog
        .create({
          data: {
            actorId: SYSTEM_USER_ID,
            entityType: 'WhatsAppTemplate',
            entityId: existing.id,
            action: AuditAction.UPDATE,
            after: { event: 'TEMPLATE_APPROVED_SWITCHED', template: t.name, language: t.language },
          },
        })
        .catch(() => undefined);
    }
  }

  console.warn(
    `[templates] approval sync: checked=${tracked.length} approved=${approved} flipped=${flipped.length}`,
  );
  return { checked: tracked.length, approved, flipped };
}
