#!/usr/bin/env tsx
/**
 * Bootstrap the first Admin user on a fresh production database
 * (Prompt 11 §4.12).
 *
 * Usage:
 *   NODE_ENV=production pnpm tsx scripts/bootstrap-admin.ts \
 *     --email "admin@theone.pt" \
 *     --phone "+962790000000" \
 *     --name-en "Clinic Owner" \
 *     --name-ar "مالك العيادة"
 *
 * Refuses to run when:
 *   - NODE_ENV !== 'production' (use the dev seed for local work)
 *   - the database already contains any user (script is one-shot)
 *
 * Prints a temp password to stdout ONCE on success. There is no
 * other channel — capture it from the deploy session.
 */

import { hashPassword } from '@/lib/auth/password';
import { generateTempPassword } from '@/lib/admin/temp-password';
import { db } from '@/lib/db';

interface CliArgs {
  email: string;
  phone: string;
  nameEn: string;
  nameAr: string;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i < argv.length - 1 ? (argv[i + 1] ?? null) : null;
  };
  const email = get('--email');
  const phone = get('--phone');
  const nameEn = get('--name-en');
  const nameAr = get('--name-ar');
  if (!email || !phone || !nameEn || !nameAr) {
    console.error(
      '[bootstrap-admin] missing required arg(s). Need --email --phone --name-en --name-ar.',
    );
    process.exit(2);
  }
  return { email, phone, nameEn, nameAr };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    console.error(
      '[bootstrap-admin] refusing to run with NODE_ENV !== "production". Use `pnpm db:reset` to seed locally.',
    );
    process.exit(1);
  }

  const args = parseArgs();
  const existing = await db.user.count();
  if (existing > 0) {
    console.error(
      `[bootstrap-admin] database already has ${existing} user(s). This script is one-shot.`,
    );
    process.exit(1);
  }

  const tempPassword = generateTempPassword(16);
  const passwordHash = await hashPassword(tempPassword);

  const user = await db.user.create({
    data: {
      email: args.email,
      phone: args.phone,
      fullNameEn: args.nameEn,
      fullNameAr: args.nameAr,
      role: 'ADMIN',
      passwordHash,
      mustChangePassword: true,
      languagePref: 'EN',
    },
    select: { id: true, email: true },
  });

  console.warn('────────────────────────────────────────────────────────────');
  console.warn('[bootstrap-admin] Admin created.');
  console.warn(`  id:    ${user.id}`);
  console.warn(`  email: ${user.email}`);
  console.warn(`  temp:  ${tempPassword}`);
  console.warn('  >> Communicate the temp password out-of-band.');
  console.warn('  >> The user is required to change it on first login.');
  console.warn('────────────────────────────────────────────────────────────');
}

main()
  .catch((err) => {
    console.error('[bootstrap-admin] failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
