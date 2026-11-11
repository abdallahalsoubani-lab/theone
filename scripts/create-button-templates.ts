#!/usr/bin/env tsx
/**
 * P64 #2 + #3 — create the confirm/decline BUTTON templates (reminder +
 * confirmation, AR + EN) in Twilio, submit them for WhatsApp approval, and
 * register them in the template registry.
 *
 * Usage (on the VM, where the Twilio creds live):
 *   pnpm tsx scripts/create-button-templates.ts --dry-run
 *   pnpm tsx scripts/create-button-templates.ts --apply
 *
 * Per template (see lib/admin/whatsapp/button-templates.ts):
 *   1. if a Content row with the same friendly name already exists, REUSE its
 *      SID (idempotent re-runs never create duplicates);
 *      otherwise POST /v1/Content (twilio/quick-reply: body + 2 buttons);
 *   2. submit /ApprovalRequests/whatsapp (category UTILITY) unless an approval
 *      request already exists for that SID;
 *   3. registerButtonTemplate → DB row with twilioApproved=false.
 *
 * Nothing switches at run time: the send paths keep using the approved
 * custom-message frame (reminder) / v2 (confirmation) until the hourly
 * approval sync sees WhatsApp's approval and flips the flag.
 */

import {
  BUTTON_TEMPLATES,
  type ButtonTemplateSpec,
  registerButtonTemplate,
} from '@/lib/admin/whatsapp/button-templates';
import { db } from '@/lib/db';

const API = 'https://content.twilio.com/v1';

function authHeader(): string | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

async function twilio<T>(auth: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok)
    throw new Error(`Twilio ${init?.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function liveContentByName(auth: string): Promise<Map<string, string>> {
  const byName = new Map<string, string>();
  let url = `${API}/Content?PageSize=100`;
  while (url) {
    const body = await twilio<{
      contents?: Array<{ sid: string; friendly_name: string }>;
      meta?: { next_page_url?: string | null };
    }>(auth, url);
    for (const c of body.contents ?? []) byName.set(c.friendly_name, c.sid);
    url = body.meta?.next_page_url ?? '';
  }
  return byName;
}

async function approvalStatus(auth: string, sid: string): Promise<string | null> {
  const body = await twilio<{ whatsapp?: { status?: string } | null }>(
    auth,
    `/Content/${sid}/ApprovalRequests`,
  );
  return body.whatsapp?.status ?? null;
}

async function createContent(auth: string, spec: ButtonTemplateSpec): Promise<string> {
  const created = await twilio<{ sid: string }>(auth, '/Content', {
    method: 'POST',
    body: JSON.stringify({
      friendly_name: spec.friendlyName,
      language: spec.language === 'AR' ? 'ar' : 'en',
      variables: spec.sample,
      types: {
        'twilio/quick-reply': {
          body: spec.body,
          actions: spec.buttons.map((b) => ({ id: b.id, title: b.title })),
        },
      },
    }),
  });
  return created.sid;
}

async function submitApproval(auth: string, spec: ButtonTemplateSpec, sid: string): Promise<void> {
  await twilio(auth, `/Content/${sid}/ApprovalRequests/whatsapp`, {
    method: 'POST',
    body: JSON.stringify({ name: spec.friendlyName, category: 'UTILITY' }),
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(
    apply ? '── APPLYING button templates ──' : '── DRY RUN — nothing will be written ──',
  );

  const auth = authHeader();
  if (!auth) {
    if (apply) {
      console.error('STOP: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not set.');
      process.exit(1);
    }
    console.warn('(dry-run without Twilio creds — listing the specs only)');
  }
  const live = auth ? await liveContentByName(auth) : new Map<string, string>();

  for (const spec of BUTTON_TEMPLATES) {
    const existingSid = live.get(spec.friendlyName) ?? null;
    const row = await db.whatsAppTemplate.findUnique({
      where: { name_language: { name: spec.name, language: spec.language } },
      select: { twilioContentSid: true, twilioApproved: true },
    });
    console.log(`\n  ${spec.name}/${spec.language} → ${spec.friendlyName}`);
    console.log(`    body:    ${spec.body}`);
    console.log(`    buttons: ${spec.buttons.map((b) => `${b.id}=«${b.title}»`).join(' | ')}`);
    console.log(`    twilio:  ${existingSid ?? 'MISSING — will be created'}`);
    console.log(
      `    db row:  ${row ? `${row.twilioContentSid ?? '—'} approved=${row.twilioApproved}` : 'MISSING — will be created'}`,
    );
    if (!apply || !auth) continue;

    const sid = existingSid ?? (await createContent(auth, spec));
    if (!existingSid) console.log(`    CREATED content ${sid}`);

    const status = await approvalStatus(auth, sid).catch(() => null);
    if (!status || status === 'unsubmitted') {
      await submitApproval(auth, spec, sid);
      console.log('    SUBMITTED for WhatsApp approval (UTILITY)');
    } else {
      console.log(`    approval already requested — status=${status}`);
    }

    const r = await registerButtonTemplate(spec, sid);
    console.log(
      `    db: ${r.created ? 'CREATED' : r.changed ? 'UPDATED' : 'already registered — no-op'}`,
    );
  }

  console.log(
    apply
      ? '\nDone — the hourly approval sync switches the send paths once WhatsApp approves.'
      : '\nDry run complete.',
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[button-templates] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
