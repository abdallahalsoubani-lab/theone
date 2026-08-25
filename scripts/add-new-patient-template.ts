#!/usr/bin/env tsx
/**
 * P52 — register the combined new-patient confirmation templates (AR + EN)
 * in the WhatsApp template registry. Zero send-path deploys after this: the
 * SID + variablesShape drive the send (48b design). Mirrors
 * scripts/add-arrival-templates.ts exactly.
 *
 * Usage:
 *   pnpm tsx scripts/add-new-patient-template.ts --dry-run
 *   pnpm tsx scripts/add-new-patient-template.ts --apply
 *
 * SID safety: before ANY apply, each expected SID is verified against the
 * LIVE Twilio Content API — mismatch or missing name → STOP, nothing
 * written. Idempotent. NOTE: business-initiated approval may still be
 * pending in Twilio; the row is written regardless (twilioApproved=true for
 * the registry), and sends begin once WhatsApp approves the template.
 */

import { db } from '@/lib/db';
import { APPROVAL_TRACKED, syncTemplateApproval } from '@/lib/whatsapp/templates/approvalSync';
import {
  NEW_PATIENT_TEMPLATE_NAME,
  NEW_PATIENT_TEMPLATES,
  applyNewPatientTemplate,
} from '@/lib/admin/whatsapp/new-patient-template';

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
    apply ? '── APPLYING new-patient templates ──' : '── DRY RUN — nothing will be written ──',
  );

  const live = await fetchLiveSids().catch((err) => {
    console.error(
      `[new-patient-template] live verification failed: ${err instanceof Error ? err.message : err}`,
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
    for (const e of NEW_PATIENT_TEMPLATES) {
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
    console.log(
      `live SID verification: all ${NEW_PATIENT_TEMPLATES.length} names match the console ✓`,
    );
  }

  for (const e of NEW_PATIENT_TEMPLATES) {
    const row = await db.whatsAppTemplate.findUnique({
      where: { name_language: { name: NEW_PATIENT_TEMPLATE_NAME, language: e.language } },
      select: { twilioContentSid: true, variablesShape: true },
    });
    console.log(`  ${NEW_PATIENT_TEMPLATE_NAME}/${e.language} → ${e.consoleName}`);
    console.log(`    row:   ${row ? 'exists' : 'MISSING — will be created'}`);
    console.log(`    SID:   ${row?.twilioContentSid ?? '—'} → ${e.expectedSid}`);
    if (apply) {
      const r = await applyNewPatientTemplate(e);
      console.log(
        `    ${r.created ? 'CREATED' : r.changed ? 'UPDATED' : 'already registered — no-op'}`,
      );
    }
  }
  if (apply) {
    const names = new Set(['new_patient_confirmation']);
    const r = await syncTemplateApproval(APPROVAL_TRACKED.filter((t) => names.has(t.name)));
    console.log(
      `approval sync: approved=${r.approved}/${r.checked} flipped=${r.flipped.join(',') || 'none'}`,
    );
  }
  console.log(apply ? '\nDone — new-patient templates registered.' : '\nDry run complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(
      `[new-patient-template] FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
