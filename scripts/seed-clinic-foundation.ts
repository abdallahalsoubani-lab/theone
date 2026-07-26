#!/usr/bin/env tsx
/**
 * Real-clinic foundation seed (Prompt 50 §3.3): the 17 real staff accounts
 * from 1-employees.csv + the 16 real rooms from 2-rooms.csv + the three
 * real specialties (PT / OT / SPEECH).
 *
 * Usage:
 *   pnpm tsx scripts/seed-clinic-foundation.ts --data-dir=$HOME/import-data --dry-run
 *   pnpm tsx scripts/seed-clinic-foundation.ts --data-dir=$HOME/import-data --apply
 *
 * - Staff are created through the EXISTING admin createUser service so
 *   hashing, validation, and uniqueness hold; language pref defaults AR;
 *   mustChangePassword is set. Idempotent by email: a re-run updates
 *   names/role/specialties and never duplicates (and never rotates an
 *   existing employee's password).
 * - The owner ruling ("every account starts fresh"): the surviving
 *   --keep-admin account ALSO gets a newly generated password
 *   (mustChangePassword set) — pass it as --reset-admin=email.
 * - Credentials land in ~/staff-credentials-<date>.txt chmod 600 — the
 *   path is printed, the passwords never are.
 * - Rooms: upsert the CSV 16 by name (bedCount from file), deactivate any
 *   existing room not in the file.
 * - Specialties: create/activate PT+OT+SPEECH, deactivate the old trial
 *   seven, link therapists per the CSV specialty column.
 */

import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { UserRole } from '@prisma/client';

import { createUser, forceResetPassword, updateUser } from '@/lib/admin/users/services';
import { db } from '@/lib/db';

// ─── CSV (BOM + CRLF tolerant; the planner-cleaned files carry no quoted
// commas, so a plain split is correct — asserted below) ────────────────────

export function parseCsv(raw: string): Array<Record<string, string>> {
  const text = raw.replace(/^﻿/, '');
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim());
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',');
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${i + 2} has ${cells.length} cells, expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((h, j) => [h, cells[j]!.trim()]));
  });
}

// ─── The three real disciplines ────────────────────────────────────────────

export const REAL_SPECIALTIES: ReadonlyArray<{ code: string; nameEn: string; nameAr: string }> = [
  { code: 'PT', nameEn: 'Physical Therapy', nameAr: 'علاج طبيعي' },
  { code: 'OT', nameEn: 'Occupational Therapy', nameAr: 'علاج وظيفي' },
  { code: 'SPEECH', nameEn: 'Speech Therapy', nameAr: 'علاج نطق' },
];

export interface EmployeeRow {
  name_en: string;
  name_ar: string;
  job_title: string;
  role: 'ADMIN' | 'SECRETARY' | 'DOCTOR' | 'THERAPIST';
  specialty: string;
  email: string;
}

export type StaffRole = 'ADMIN' | 'SECRETARY' | 'DOCTOR' | 'THERAPIST';

export function validateEmployee(row: Record<string, string>, index: number): EmployeeRow {
  const role = (row.role?.toUpperCase() ?? '') as StaffRole;
  if (!['ADMIN', 'SECRETARY', 'DOCTOR', 'THERAPIST'].includes(role)) {
    throw new Error(`employees row ${index + 2}: invalid role "${row.role}"`);
  }
  const specialty = row.specialty?.toUpperCase() ?? '';
  if (role === 'THERAPIST' && !REAL_SPECIALTIES.some((s) => s.code === specialty)) {
    throw new Error(`employees row ${index + 2}: therapist needs specialty PT/OT/SPEECH`);
  }
  if (!row.email?.includes('@')) throw new Error(`employees row ${index + 2}: invalid email`);
  if (!row.name_en && !row.name_ar) {
    throw new Error(`employees row ${index + 2}: needs at least one name`);
  }
  return {
    name_en: row.name_en ?? '',
    name_ar: row.name_ar ?? '',
    job_title: row.job_title ?? '',
    role,
    specialty,
    email: row.email!.toLowerCase(),
  };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean;
  dataDir: string;
  resetAdminEmail: string | null;
  credentialsPath: string;
  /** Existing employee emails whose password should be FORCE-ROTATED into
   *  the credentials file (recovery path: an earlier crashed run created
   *  the account but its temp password was never written anywhere). */
  rotateEmails: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const apply = argv.includes('--apply');
  const dataDirArg = argv.find((a) => a.startsWith('--data-dir='));
  if (!dataDirArg) throw new Error('--data-dir=<path> is required');
  const resetAdmin = argv.find((a) => a.startsWith('--reset-admin='));
  const rotate = argv.find((a) => a.startsWith('--rotate='));
  const date = new Date().toISOString().slice(0, 10);
  return {
    apply,
    dataDir: dataDirArg.split('=')[1]!,
    resetAdminEmail: resetAdmin?.split('=')[1]?.toLowerCase() ?? null,
    credentialsPath: join(homedir(), `staff-credentials-${date}.txt`),
    rotateEmails: (rotate?.split('=')[1] ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  };
}

export async function runFoundationSeed(args: CliArgs, prisma: typeof db = db): Promise<void> {
  const employeesRaw = readFileSync(join(args.dataDir, '1-employees.csv'), 'utf8');
  const roomsRaw = readFileSync(join(args.dataDir, '2-rooms.csv'), 'utf8');
  const employees = parseCsv(employeesRaw).map(validateEmployee);
  const rooms = parseCsv(roomsRaw).map((r, i) => {
    const bedCount = Number(r.bed_count);
    if (!r.name) throw new Error(`rooms row ${i + 2}: missing name`);
    if (!Number.isInteger(bedCount) || bedCount < 1) {
      throw new Error(`rooms row ${i + 2}: bad bed_count "${r.bed_count}"`);
    }
    return { name: r.name, bedCount, active: r.active?.toUpperCase() !== 'FALSE' };
  });

  console.log(`Parsed ${employees.length} employees, ${rooms.length} rooms.`);

  if (!args.apply) {
    console.log('── DRY RUN — nothing will be written ──');
    for (const s of REAL_SPECIALTIES) console.log(`  specialty: ${s.code} (${s.nameAr})`);
    for (const e of employees) {
      const existing = await prisma.user.findFirst({
        where: { email: e.email, deletedAt: null },
        select: { id: true },
      });
      console.log(
        `  staff ${existing ? 'UPDATE' : 'CREATE'}: ${e.email} role=${e.role}${e.specialty ? ` specialty=${e.specialty}` : ''}`,
      );
    }
    for (const r of rooms) console.log(`  room upsert: ${r.name} beds=${r.bedCount}`);
    if (args.resetAdminEmail) console.log(`  admin password reset: ${args.resetAdminEmail}`);
    console.log(`  credentials file would be written to: ${args.credentialsPath}`);
    return;
  }

  console.log('── APPLYING ──');

  // 1. Specialties: the three real ones active, trial ones deactivated.
  const specialtyIdByCode = new Map<string, string>();
  for (const s of REAL_SPECIALTIES) {
    const row = await prisma.specialty.upsert({
      where: { nameEn: s.nameEn },
      update: { nameAr: s.nameAr, active: true },
      create: { nameEn: s.nameEn, nameAr: s.nameAr, active: true },
      select: { id: true },
    });
    specialtyIdByCode.set(s.code, row.id);
  }
  const deactivated = await prisma.specialty.updateMany({
    where: { nameEn: { notIn: REAL_SPECIALTIES.map((s) => s.nameEn) }, active: true },
    data: { active: false },
  });
  console.log(`Specialties: 3 active, ${deactivated.count} trial specialties deactivated.`);

  // 2. Staff — through the audited admin service (hashing + validation).
  const credentialLines: string[] = [];
  let created = 0;
  let updated = 0;
  for (const e of employees) {
    const specialtyIds =
      e.role === 'THERAPIST' ? [specialtyIdByCode.get(e.specialty)!].filter(Boolean) : [];
    const existing = await prisma.user.findFirst({
      where: { email: e.email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      await updateUser({
        id: existing.id,
        fullNameEn: e.name_en,
        fullNameAr: e.name_ar,
        email: e.email,
        phone: null,
        role: e.role,
        languagePref: 'AR',
        specialtyIds,
        mustChangePassword: true,
      });
      updated += 1;
      // Existing employee keeps their password — re-runs never rotate —
      // UNLESS explicitly listed in --rotate (crashed-run recovery).
      if (args.rotateEmails.includes(e.email)) {
        const rotated = await forceResetPassword(existing.id);
        credentialLines.push(
          `${e.name_ar || e.name_en}\t${e.email}\t${e.role}${e.specialty ? `/${e.specialty}` : ''}\t${rotated.tempPassword}`,
        );
        console.log(`Rotated password for existing account: ${e.email}`);
      }
    } else {
      const result = await createUser({
        fullNameEn: e.name_en,
        fullNameAr: e.name_ar,
        email: e.email,
        phone: null,
        role: e.role,
        languagePref: 'AR',
        specialtyIds,
        mustChangePassword: true,
      });
      created += 1;
      credentialLines.push(
        `${e.name_ar || e.name_en}\t${e.email}\t${e.role}${e.specialty ? `/${e.specialty}` : ''}\t${result.tempPassword}`,
      );
    }
  }
  console.log(`Staff: ${created} created, ${updated} updated.`);

  // 3. Owner ruling — the surviving admin's password also starts fresh.
  if (args.resetAdminEmail) {
    const admin = await prisma.user.findFirst({
      where: { email: args.resetAdminEmail, role: UserRole.ADMIN, deletedAt: null },
      select: { id: true, email: true, fullNameAr: true, fullNameEn: true },
    });
    if (!admin) throw new Error(`--reset-admin account not found: ${args.resetAdminEmail}`);
    const reset = await forceResetPassword(admin.id);
    credentialLines.unshift(
      `${admin.fullNameAr || admin.fullNameEn}\t${admin.email}\tADMIN\t${reset.tempPassword}`,
    );
    console.log(`Admin password reset: ${admin.email} (mustChangePassword set).`);
  }

  // 4. Rooms: upsert by name, deactivate anything not in the file.
  let roomsCreated = 0;
  for (const r of rooms) {
    const existing = await prisma.room.findFirst({ where: { name: r.name }, select: { id: true } });
    if (existing) {
      await prisma.room.update({
        where: { id: existing.id },
        data: { bedCount: r.bedCount, active: r.active },
      });
    } else {
      await prisma.room.create({ data: { name: r.name, bedCount: r.bedCount, active: r.active } });
      roomsCreated += 1;
    }
  }
  const oldRooms = await prisma.room.updateMany({
    where: { name: { notIn: rooms.map((r) => r.name) }, active: true },
    data: { active: false },
  });
  console.log(`Rooms: ${roomsCreated} created, ${oldRooms.count} old rooms deactivated.`);

  // 5. Credentials file — 600, path printed, contents never.
  if (credentialLines.length > 0) {
    const body =
      'name\temail\trole\ttemp_password\n' +
      credentialLines.join('\n') +
      '\n\nAll accounts must change password on first login.\nDELETE THIS FILE after distributing.\n';
    writeFileSync(args.credentialsPath, body, { mode: 0o600 });
    chmodSync(args.credentialsPath, 0o600);
    console.log(
      `Credentials written: ${args.credentialsPath} (${credentialLines.length} accounts)`,
    );
  } else {
    console.log('No new credentials to write (all employees already existed).');
  }
}

if (process.argv[1]?.endsWith('seed-clinic-foundation.ts')) {
  runFoundationSeed(parseArgs(process.argv.slice(2)))
    .then(() => {
      console.log('\nDone.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(
        `\n[seed-foundation] FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    });
}

export { parseArgs };
