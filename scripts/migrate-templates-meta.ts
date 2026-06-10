/**
 * One-shot, idempotent migration of the WhatsAppTemplate table for the Meta
 * Cloud API switch. Touches ONLY the WhatsAppTemplate table — never resets the
 * DB, never touches any other table.
 *
 *   pnpm templates:migrate-meta
 *   # → dotenv -e .env.local -- tsx scripts/migrate-templates-meta.ts
 *
 * What it does (and nothing more):
 *   1. Renames the four templates that were recreated in Meta under `_v2`
 *      names. Idempotent: rows already on the new name match nothing.
 *   2. Nulls `twilioContentSid` for every row whose value is a dummy
 *      `HX_DEV_*` placeholder. Real Twilio SIDs (e.g. `HX876…`) are left
 *      intact — Twilio is the dormant backup provider and we don't delete it.
 *   3. Sets `metaApprovalStatus = PENDING` for the templates that have been
 *      created in Meta and are in review — but only when the row is still
 *      NOT_SUBMITTED, so a later APPROVED flip is never downgraded.
 *   4. Disables the two phase-two deferred templates so their send paths skip
 *      cleanly: `patient_account_credentials` (rejected by Meta) → inactive +
 *      REJECTED; `otp_login` (not yet created in Meta) → inactive.
 *
 * It does NOT set APPROVED. Run `pnpm templates:approve` for that, AFTER Meta
 * actually approves the templates.
 */

import { PrismaClient, WaTemplateApprovalStatus } from '@prisma/client';

const db = new PrismaClient();

/** Old logical name → new `_v2` name (templates recreated in Meta). */
const RENAME_MAP: ReadonlyArray<readonly [string, string]> = [
  ['appointment_confirmation', 'appointment_confirmation_v2'],
  ['appointment_reminder_30min', 'appointment_reminder_v2'],
  ['appointment_cancelled', 'appointment_cancelled_v2'],
  ['home_exercise_reminder', 'home_exercise_reminder_v2'],
];

/** Templates created in Meta WhatsApp Manager and currently in review. */
const META_SUBMITTED_TEMPLATES = [
  'appointment_confirmation_v2',
  'appointment_reminder_v2',
  'appointment_rescheduled',
  'appointment_cancelled_v2',
  'home_exercise_reminder_v2',
] as const;

async function main() {
  console.log('[migrate-meta] BEFORE:');
  await printRows();

  // 1. Rename the recreated templates to their `_v2` names.
  let renamed = 0;
  for (const [oldName, newName] of RENAME_MAP) {
    const r = await db.whatsAppTemplate.updateMany({
      where: { name: oldName },
      data: { name: newName, metaTemplateName: newName },
    });
    renamed += r.count;
  }
  console.log(`\n[migrate-meta] renamed ${renamed} row(s) to _v2 names`);

  // 2. Clear dummy Twilio ContentSids only (HX_DEV_*). Keep real SIDs.
  const cleared = await db.whatsAppTemplate.updateMany({
    where: { twilioContentSid: { startsWith: 'HX_DEV_' } },
    data: { twilioContentSid: null, twilioApproved: false },
  });
  console.log(`[migrate-meta] cleared ${cleared.count} dummy HX_DEV_* twilioContentSid value(s)`);

  // 3. Mark the Meta-submitted templates as PENDING — but never downgrade
  //    a row that has already been flipped to APPROVED.
  const pending = await db.whatsAppTemplate.updateMany({
    where: {
      name: { in: [...META_SUBMITTED_TEMPLATES] },
      metaApprovalStatus: WaTemplateApprovalStatus.NOT_SUBMITTED,
    },
    data: { metaApprovalStatus: WaTemplateApprovalStatus.PENDING },
  });
  console.log(`[migrate-meta] set ${pending.count} row(s) to metaApprovalStatus=PENDING`);

  // 4a. patient_account_credentials — rejected by Meta, deferred → inactive.
  const creds = await db.whatsAppTemplate.updateMany({
    where: { name: 'patient_account_credentials' },
    data: { active: false, metaApprovalStatus: WaTemplateApprovalStatus.REJECTED },
  });
  console.log(
    `[migrate-meta] disabled patient_account_credentials (${creds.count} row(s), REJECTED)`,
  );

  // 4b. otp_login — not yet created in Meta, deferred → inactive.
  const otp = await db.whatsAppTemplate.updateMany({
    where: { name: 'otp_login' },
    data: { active: false },
  });
  console.log(`[migrate-meta] disabled otp_login (${otp.count} row(s))`);

  console.log('\n[migrate-meta] AFTER:');
  await printRows();
  console.log(
    '\n[migrate-meta] done. Run `pnpm templates:approve` once Meta approves the templates.',
  );
}

async function printRows() {
  const rows = await db.whatsAppTemplate.findMany({
    orderBy: [{ name: 'asc' }, { language: 'asc' }],
  });
  console.log(`  count: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(30)} ${r.language}  active=${String(r.active).padEnd(5)} meta=${r.metaApprovalStatus.padEnd(13)} twilio=${r.twilioContentSid ?? 'null'}`,
    );
  }
}

main()
  .catch((err) => {
    console.error('[migrate-meta] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
