/**
 * Seed runner — three tiers per Prompt 2 §4.8.
 *
 *   Tier 1  reference data    always runs, idempotent (upsert)
 *   Tier 2  dev/test fixtures runs when NODE_ENV !== 'production'
 *
 * Tier 3 (deterministic fixtures for the test suite) lives in prisma/fixtures.ts
 * and is invoked by test setup, not by this script.
 */

import { PrismaClient } from '@prisma/client';

import { seedDevData } from './seed/dev-data';
import { seedCustomQuestions, seedReference } from './seed/reference-data';

const db = new PrismaClient();

async function main() {
  console.log('[seed] reference data — specialties, rooms, WhatsApp templates');
  await seedReference(db);

  if (process.env.NODE_ENV === 'production') {
    console.log('[seed] NODE_ENV=production — skipping dev data and custom-question seed');
    return;
  }

  console.log('[seed] dev data — staff users, patients, intakes, appointments, plans, notes');
  await seedDevData(db);

  console.log('[seed] custom intake questions (depends on Admin)');
  await seedCustomQuestions(db);

  console.log('[seed] done');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
