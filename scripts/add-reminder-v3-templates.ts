#!/usr/bin/env tsx
/**
 * P53 — register the one-reminder-per-patient-per-day templates (single_v3 +
 * multi, AR + EN = 4 rows). Zero send-path deploys after this: SID +
 * variablesShape drive the send. Mirrors scripts/add-arrival-templates.ts.
 *
 * Usage:
 *   pnpm tsx scripts/add-reminder-v3-templates.ts --dry-run
 *   pnpm tsx scripts/add-reminder-v3-templates.ts --apply
 *
 * SID safety: every expected SID is verified against the LIVE Twilio Content
 * API before apply — mismatch/missing → STOP. Idempotent. The old
 * appointment_reminder_v2 row is left in place, unused.
 */

import { db } from '@/lib/db';
import {
  REMINDER_V3_TEMPLATES,
  applyReminderV3Template,
} from '@/lib/admin/whatsapp/reminder-v3-templates';

async function fetchLiveSids(): Promise<Map<string, string> | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const byName = new Map<string, string>();
  let url = 'https://content.twilio.com/v1/Content?PageSize=100';
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`Twilio Content API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      contents?: Array<{ sid: string; friendly_name: string }>;
      meta?: { next_page_url?: string | null };
    };
    for (const c of body.contents ?? []) byName.set(c.friendly_name, c.sid);
    url = body.meta?.next_page_url ?? '';
  }
  return byName;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '── APPLYING reminder v3 templates ──' : '── DRY RUN ──');

  const live = await fetchLiveSids().catch((err) => {
    console.error(
      `[reminder-v3] live verification failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  });
  if (!live) {
    if (apply) {
      console.error('STOP: cannot verify SIDs against the live Twilio console (no creds/API).');
      process.exit(1);
    }
    console.warn('(dry-run without Twilio creds — live SID verification runs on the VM)');
  } else {
    for (const e of REMINDER_V3_TEMPLATES) {
      const liveSid = live.get(e.consoleName);
      if (!liveSid) {
        console.error(`STOP: "${e.consoleName}" not found in the live Twilio content list.`);
        process.exit(1);
      }
      if (liveSid.toLowerCase() !== e.expectedSid.toLowerCase()) {
        console.error(
          `STOP: SID mismatch for ${e.consoleName} — live=${liveSid} expected=${e.expectedSid}.`,
        );
        process.exit(1);
      }
    }
    console.log(`live SID verification: all ${REMINDER_V3_TEMPLATES.length} names match ✓`);
  }

  for (const e of REMINDER_V3_TEMPLATES) {
    const row = await db.whatsAppTemplate.findUnique({
      where: { name_language: { name: e.templateName, language: e.language } },
      select: { twilioContentSid: true },
    });
    console.log(`  ${e.templateName}/${e.language} → ${e.consoleName}`);
    console.log(
      `    row: ${row ? 'exists' : 'MISSING — will be created'}  SID: ${row?.twilioContentSid ?? '—'} → ${e.expectedSid}`,
    );
    if (apply) {
      const r = await applyReminderV3Template(e);
      console.log(
        `    ${r.created ? 'CREATED' : r.changed ? 'UPDATED' : 'already registered — no-op'}`,
      );
    }
  }
  console.log(apply ? '\nDone — reminder v3 templates registered.' : '\nDry run complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[reminder-v3] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
