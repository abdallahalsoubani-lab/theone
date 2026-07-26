#!/usr/bin/env tsx
/**
 * Prompt 51 — seed the clinic's real intake questions (owner-signed mapping):
 * 19 active PEDIATRIC custom questions (verbatim sheet labels, sheet-flow
 * order, no sections, no conditionality) + 1 inactive BOTH archive question
 * for import notes. Adults need nothing — AdultIntakeData already IS the
 * sheet.
 *
 * Usage:
 *   pnpm tsx scripts/seed-intake-questions.ts --dry-run
 *   pnpm tsx scripts/seed-intake-questions.ts --apply
 *
 * Idempotent by nameAr: re-runs update type/options/order/active in place,
 * never duplicate. createdById = the reserved `system` actor.
 */

import { db } from '@/lib/db';
import { IMPORT_QUESTIONS } from '@/lib/intake/import-mapping';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

export async function runIntakeQuestionSeed(
  apply: boolean,
  prisma: typeof db = db,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const q of IMPORT_QUESTIONS) {
    const existing = await prisma.intakeCustomQuestion.findFirst({
      where: { nameAr: q.nameAr },
      select: { id: true },
    });
    const label = `${q.appliesTo}${q.active ? '' : ' (archive)'} ${q.type} — ${q.nameAr}`;
    if (!apply) {
      console.log(`  would ${existing ? 'UPDATE' : 'CREATE'}: ${label}`);
      continue;
    }
    const data = {
      nameEn: q.nameEn,
      nameAr: q.nameAr,
      type: q.type,
      options: q.options ?? undefined,
      appliesTo: q.appliesTo,
      required: false,
      displayOrder: q.displayOrder,
      active: q.active,
    };
    if (existing) {
      await prisma.intakeCustomQuestion.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.intakeCustomQuestion.create({
        data: { ...data, createdById: SYSTEM_USER_ID },
      });
      created += 1;
    }
  }

  const summary = apply
    ? `Created ${created}, updated ${updated}.`
    : `Dry run — ${IMPORT_QUESTIONS.length} questions would be seeded (nothing written).`;
  console.log(summary);
  return { created, updated };
}

if (process.argv[1]?.endsWith('seed-intake-questions.ts')) {
  const apply = process.argv.includes('--apply');
  console.log(
    apply ? '── APPLYING intake question seed ──' : '── DRY RUN — nothing will be written ──',
  );
  runIntakeQuestionSeed(apply)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[seed-intake] FAILED: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
