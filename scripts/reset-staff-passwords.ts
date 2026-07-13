#!/usr/bin/env tsx
/**
 * Prompt 22 Part 1 §3 — reset every staff password for the demo phase.
 *
 * Targets every non-deleted, non-PATIENT user except the internal `system`
 * actor (it has no login and must never get one). For each target:
 *
 *   - generates a readable `Word-Word-1234` password (policy-compliant),
 *   - sets the bcrypt hash directly,
 *   - sets mustChangePassword = false (guaranteed working demo logins —
 *     explicitly requested; the forced-change flow bug is fixed separately),
 *   - clears failedLoginAttempts / lockedUntil,
 *   - writes one AuditLog row (actor `system`) with NO password material.
 *
 * Plaintext passwords are written ONLY to the `--out` file (chmod 600) —
 * never to stdout, never to the audit payload, never committed.
 * Patients (phone-OTP login, no passwords) are appended to the same file as
 * a phone list for the demo operators.
 *
 * Usage (on the VM):
 *   pnpm dotenv -e .env.local -- tsx scripts/reset-staff-passwords.ts                # dry-run
 *   pnpm dotenv -e .env.local -- tsx scripts/reset-staff-passwords.ts --apply \
 *     --out ~/credentials-$(date +%F).txt
 */

import { chmodSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { generateReadablePassword } from '../lib/admin/temp-password';

const db = new PrismaClient();
const BCRYPT_COST = 12; // keep in sync with lib/auth/password.ts

const apply = process.argv.includes('--apply');

function outPath(): string {
  const i = process.argv.indexOf('--out');
  const raw =
    i >= 0 && process.argv[i + 1]
      ? process.argv[i + 1]!
      : `~/credentials-${new Date().toISOString().slice(0, 10)}.txt`;
  return resolve(raw.replace(/^~(?=$|\/)/, homedir()));
}

function log(line: string): void {
  console.warn(`[reset-staff-passwords]${apply ? '' : ' (dry-run)'} ${line}`);
}

async function main(): Promise<void> {
  const staff = await db.user.findMany({
    where: { role: { not: 'PATIENT' }, deletedAt: null, id: { not: 'system' } },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, email: true, phone: true, role: true, fullNameEn: true, fullNameAr: true },
  });
  const patients = await db.user.findMany({
    where: { role: 'PATIENT', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { fullNameEn: true, fullNameAr: true, phone: true, languagePref: true },
  });

  log(`staff accounts targeted: ${staff.length}`);
  for (const u of staff) log(`  ${u.role.padEnd(10)} ${u.email ?? '(no email)'} — ${u.fullNameEn}`);
  log(`patient accounts (phone-OTP, listed only): ${patients.length}`);

  if (!apply) {
    log('dry-run complete — re-run with --apply to reset passwords');
    return;
  }

  const actor = await db.user.findUnique({ where: { id: 'system' }, select: { id: true } });
  const actorId =
    actor?.id ??
    (
      await db.user.findFirstOrThrow({
        where: { role: 'ADMIN', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
    ).id;

  const rows: string[] = [];
  for (const u of staff) {
    const password = generateReadablePassword(randomInt);
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await db.$transaction([
      db.user.update({
        where: { id: u.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      db.auditLog.create({
        data: {
          actorId,
          entityType: 'User',
          entityId: u.id,
          action: 'UPDATE',
          after: { passwordReset: true, by: 'scripts/reset-staff-passwords.ts' },
        },
      }),
    ]);
    rows.push([u.email ?? '(no email)', u.role, u.fullNameEn, u.fullNameAr, password].join(' · '));
    log(`reset ${u.role} ${u.email ?? u.id}`);
  }

  const file = outPath();
  const stamp = new Date().toISOString();
  const contents = [
    `Theone.pt staff credentials — generated ${stamp} by scripts/reset-staff-passwords.ts`,
    'KEEP PRIVATE. Delete after the demo. Never commit.',
    '',
    'email · role · full name (EN) · full name (AR) · password',
    '─'.repeat(80),
    ...rows,
    '',
    'Patients (log in via phone + WhatsApp OTP — no passwords):',
    'name (EN) · name (AR) · phone · language',
    '─'.repeat(80),
    ...patients.map((p) => [p.fullNameEn, p.fullNameAr, p.phone, p.languagePref].join(' · ')),
    '',
  ].join('\n');
  writeFileSync(file, contents, { mode: 0o600 });
  chmodSync(file, 0o600);
  log(`credentials written to: ${file}`);
}

main()
  .catch((err) => {
    console.error('[reset-staff-passwords] failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
