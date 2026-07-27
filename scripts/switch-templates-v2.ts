#!/usr/bin/env tsx
/**
 * P54 — switch the four live reminder/rescheduled registry rows to the
 * APPROVED v2 templates (buttons + day-name shape). Zero send-path code
 * changes (48b design guarantee: SID + variablesShape drive everything).
 *
 * Usage:
 *   pnpm tsx scripts/switch-templates-v2.ts --dry-run
 *   pnpm tsx scripts/switch-templates-v2.ts --apply
 *
 * SID safety: before ANY apply, every expected SID is verified against the
 * LIVE Twilio Content API (the console is the source of truth — never the
 * chat). Any mismatch or missing content name → STOP, nothing written.
 * Idempotent: a re-run over already-switched rows is a no-op.
 */

import { db } from '@/lib/db';
import { V2_SWITCH, applyV2Switch } from '@/lib/admin/whatsapp/switch-v2';

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
  console.log(
    apply ? '── APPLYING v2 template switch ──' : '── DRY RUN — nothing will be written ──',
  );

  // Live SID verification (mandatory for apply).
  const live = await fetchLiveSids().catch((err) => {
    console.error(
      `[switch-v2] live verification failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  });
  if (!live) {
    if (apply) {
      console.error('STOP: cannot verify SIDs against the live Twilio console (no creds/API).');
      process.exit(1);
    }
    console.warn('(dry-run without Twilio creds — live SID verification will run on the VM)');
  } else {
    for (const e of V2_SWITCH) {
      const liveSid = live.get(e.consoleName);
      if (!liveSid) {
        console.error(`STOP: "${e.consoleName}" not found in the live Twilio content list.`);
        process.exit(1);
      }
      if (liveSid.toLowerCase() !== e.expectedSid.toLowerCase()) {
        console.error(
          `STOP: SID mismatch for ${e.consoleName} — live=${liveSid} expected=${e.expectedSid}. Ask the owner to re-copy from the console.`,
        );
        process.exit(1);
      }
    }
    console.log(`live SID verification: all ${V2_SWITCH.length} names match the console ✓`);
  }

  for (const e of V2_SWITCH) {
    const row = await db.whatsAppTemplate.findUnique({
      where: { name_language: { name: e.logicalName, language: e.language } },
      select: { twilioContentSid: true, variablesShape: true },
    });
    if (!row) {
      console.error(`STOP: registry row missing: ${e.logicalName}/${e.language}`);
      process.exit(1);
    }
    const label = `${e.logicalName}/${e.language} → ${e.consoleName}`;
    console.log(`  ${label}`);
    console.log(`    SID:   ${row.twilioContentSid ?? '—'} → ${e.expectedSid}`);
    console.log(
      `    shape: ${JSON.stringify(row.variablesShape)} → ["patientName","dayName","date","time"]`,
    );
    if (apply) {
      const r = await applyV2Switch(e);
      console.log(`    ${r.changed ? 'APPLIED' : 'already switched — no-op'}`);
    }
  }
  console.log(apply ? '\nDone — 4 rows on the approved v2 pack.' : '\nDry run complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[switch-v2] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
