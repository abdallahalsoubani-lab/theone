/**
 * VM / staging seed — reference data + staff accounts only.
 *
 *   pnpm dotenv -e .env.local -- tsx scripts/seed-vm-production.ts
 *
 * Does NOT seed patients, appointments, sessions, plans, exercises, or custom
 * intake questions. Run `pnpm templates:migrate-meta` separately (or before)
 * to align WhatsApp template rows with Meta _v2 names.
 */

import { PrismaClient } from '@prisma/client';

import { seedStaffOnly } from '../prisma/seed/dev-data';
import { seedReference } from '../prisma/seed/reference-data';

const db = new PrismaClient();

async function main() {
  console.log('[seed:vm] reference data (specialties, rooms, templates, clinic settings)');
  await seedReference(db);

  console.log('[seed:vm] staff accounts only (admin, doctor, secretary, 3 therapists)');
  await seedStaffOnly(db);

  console.log('[seed:vm] done — run `pnpm templates:migrate-meta` if not already applied');
}

main()
  .catch((err) => {
    console.error('[seed:vm] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
