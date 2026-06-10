/**
 * Flip the Meta WhatsApp templates to APPROVED — run this in ONE command AFTER
 * Meta actually approves them in WhatsApp Manager. Until then the provider
 * refuses to send (MetaWhatsAppProvider.sendTemplate requires APPROVED), which
 * is the safe default.
 *
 *   pnpm templates:approve                 # approve the default set
 *   pnpm templates:approve appointment_confirmation_v2 home_exercise_reminder_v2
 *                                          # approve only the named ones
 *
 * Touches ONLY the WhatsAppTemplate table. Sets metaApprovalStatus=APPROVED
 * and stamps metaApprovedAt. Idempotent.
 */

import { PrismaClient, WaTemplateApprovalStatus } from '@prisma/client';

const db = new PrismaClient();

/**
 * Default set: the templates created in Meta WhatsApp Manager that are
 * eligible for approval. `patient_account_credentials` (rejected by Meta) and
 * `otp_login` (deferred to phase 2) are intentionally excluded.
 */
const DEFAULT_TEMPLATES = [
  'appointment_confirmation_v2',
  'appointment_reminder_v2',
  'appointment_rescheduled',
  'appointment_cancelled_v2',
  'home_exercise_reminder_v2',
] as const;

async function main() {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const names = argv.length > 0 ? argv : [...DEFAULT_TEMPLATES];

  console.log(`[approve] approving template(s): ${names.join(', ')}`);

  const result = await db.whatsAppTemplate.updateMany({
    where: { name: { in: names } },
    data: {
      metaApprovalStatus: WaTemplateApprovalStatus.APPROVED,
      metaApprovedAt: new Date(),
    },
  });

  console.log(`[approve] updated ${result.count} row(s) to APPROVED`);

  const rows = await db.whatsAppTemplate.findMany({
    where: { name: { in: names } },
    orderBy: [{ name: 'asc' }, { language: 'asc' }],
    select: { name: true, language: true, metaApprovalStatus: true, metaApprovedAt: true },
  });
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(28)} ${r.language}  ${r.metaApprovalStatus}  ${r.metaApprovedAt?.toISOString() ?? ''}`,
    );
  }
}

main()
  .catch((err) => {
    console.error('[approve] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
