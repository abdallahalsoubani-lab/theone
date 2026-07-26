import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/**
 * P50 §3.3 — foundation seed: BOM-tolerant CSV parse, role/specialty
 * mapping, idempotency by email, and the credentials file's 600 mode.
 */

const created: Array<Record<string, unknown>> = [];
const updated: Array<Record<string, unknown>> = [];
vi.mock('@/lib/admin/users/services', () => ({
  createUser: vi.fn(async (input: Record<string, unknown>) => {
    created.push(input);
    return { userId: `u-${created.length}`, tempPassword: `TempPw-${created.length}` };
  }),
  updateUser: vi.fn(async (input: Record<string, unknown>) => {
    updated.push(input);
    return { userId: input.id };
  }),
  forceResetPassword: vi.fn(async (id: string) => ({ userId: id, tempPassword: 'AdminPw-1' })),
}));

import { parseCsv, runFoundationSeed, validateEmployee } from '../seed-clinic-foundation';

const BOM = '﻿';
const EMPLOYEES_CSV =
  BOM +
  'name_en,name_ar,job_title,role,specialty,email\r\n' +
  'Heba Quqa,هبة قوقا,Physical Therapist,THERAPIST,PT,heba@x.com\r\n' +
  'Dana S,دانا,Speech Therapist,THERAPIST,SPEECH,dana@x.com\r\n' +
  'Waad H,وعد,Hr Manager,SECRETARY,,waad@x.com\r\n' +
  'Dr Sahar,د. سحر,Head Of Pt,DOCTOR,,sahar@x.com\r\n';
const ROOMS_CSV = BOM + 'name,bed_count,active\r\nDmi Gym,5,TRUE\r\nSpider Cage Room,5,TRUE\r\n';

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p50-seed-'));
  writeFileSync(join(dir, '1-employees.csv'), EMPLOYEES_CSV);
  writeFileSync(join(dir, '2-rooms.csv'), ROOMS_CSV);
  return dir;
}

function fakeDb(existingEmails: string[] = []) {
  const rooms: Array<Record<string, unknown>> = [];
  const client = {
    user: {
      findFirst: vi.fn(async ({ where }: { where: { email?: string; role?: string } }) => {
        if (where.role === 'ADMIN') {
          return where.email === 'owner@x.com'
            ? { id: 'admin-1', email: 'owner@x.com', fullNameAr: 'المالك', fullNameEn: 'Owner' }
            : null;
        }
        return existingEmails.includes(where.email ?? '')
          ? { id: `existing-${where.email}` }
          : null;
      }),
    },
    specialty: {
      upsert: vi.fn(async ({ where }: { where: { nameEn: string } }) => ({
        id: `spec-${where.nameEn}`,
      })),
      updateMany: vi.fn(async () => ({ count: 7 })),
    },
    room: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rooms.push(data);
        return data;
      }),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 6 })),
    },
  };
  return { client: client as never, rooms };
}

function reset(): void {
  created.length = 0;
  updated.length = 0;
}

describe('parseCsv', () => {
  it('strips the BOM and tolerates CRLF', () => {
    const rows = parseCsv(EMPLOYEES_CSV);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.name_en).toBe('Heba Quqa');
    expect(Object.keys(rows[0]!)[0]).toBe('name_en'); // BOM did not pollute the header
  });

  it('rejects a ragged row', () => {
    expect(() => parseCsv('a,b\r\n1,2,3\r\n')).toThrow(/row 2/);
  });
});

describe('validateEmployee', () => {
  it('maps role + specialty and lowercases email', () => {
    const e = validateEmployee(
      {
        name_en: 'X',
        name_ar: 'س',
        job_title: 'PT',
        role: 'therapist',
        specialty: 'pt',
        email: 'A@X.com',
      },
      0,
    );
    expect(e.role).toBe('THERAPIST');
    expect(e.specialty).toBe('PT');
    expect(e.email).toBe('a@x.com');
  });

  it('rejects a therapist without a real specialty and unknown roles', () => {
    expect(() =>
      validateEmployee({ name_en: 'X', role: 'THERAPIST', specialty: 'YOGA', email: 'a@x.com' }, 0),
    ).toThrow(/specialty/);
    expect(() =>
      validateEmployee({ name_en: 'X', role: 'PATIENT', specialty: '', email: 'a@x.com' }, 0),
    ).toThrow(/role/);
  });
});

describe('runFoundationSeed', () => {
  const baseArgs = (dir: string, credPath: string) => ({
    apply: true,
    dataDir: dir,
    resetAdminEmail: 'owner@x.com',
    credentialsPath: credPath,
    rotateEmails: [] as string[],
  });

  it('creates fresh staff with role/specialty, resets the admin, writes a 600 credentials file', async () => {
    reset();
    const dir = makeDataDir();
    const credPath = join(dir, 'creds.txt');
    const { client } = fakeDb();
    await runFoundationSeed(baseArgs(dir, credPath), client);

    expect(created).toHaveLength(4);
    const heba = created.find((c) => c.email === 'heba@x.com')!;
    expect(heba).toMatchObject({
      role: 'THERAPIST',
      specialtyIds: ['spec-Physical Therapy'],
      languagePref: 'AR',
      mustChangePassword: true,
      phone: null,
    });
    const waad = created.find((c) => c.email === 'waad@x.com')!;
    expect(waad).toMatchObject({ role: 'SECRETARY', specialtyIds: [] });

    // Credentials file: 600, admin line FIRST (owner ruling — all accounts
    // fresh), one line per created employee.
    const mode = statSync(credPath).mode & 0o777;
    expect(mode).toBe(0o600);
    const body = (await import('node:fs')).readFileSync(credPath, 'utf8');
    expect(body).toContain('owner@x.com\tADMIN\tAdminPw-1');
    expect(body.split('\n').filter((l) => l.includes('\t')).length).toBe(6); // header + 5 accounts
  });

  it('is idempotent by email: existing employees are UPDATED, never duplicated, passwords kept', async () => {
    reset();
    const dir = makeDataDir();
    const credPath = join(dir, 'creds.txt');
    const { client } = fakeDb(['heba@x.com', 'dana@x.com']);
    await runFoundationSeed(baseArgs(dir, credPath), client);
    expect(created.map((c) => c.email)).toEqual(['waad@x.com', 'sahar@x.com']);
    expect(updated.map((u) => u.id)).toEqual(['existing-heba@x.com', 'existing-dana@x.com']);
    // Updated employees do NOT appear in the credentials file (no rotation).
    const body = (await import('node:fs')).readFileSync(credPath, 'utf8');
    expect(body).not.toContain('heba@x.com');
  });

  it('--rotate forces a password reset for a listed EXISTING employee into the file (crash recovery)', async () => {
    reset();
    const dir = makeDataDir();
    const credPath = join(dir, 'creds.txt');
    const { client } = fakeDb(['heba@x.com']);
    await runFoundationSeed({ ...baseArgs(dir, credPath), rotateEmails: ['heba@x.com'] }, client);
    // heba exists → updated, not created — but her password IS rotated in.
    expect(created.map((c) => c.email)).not.toContain('heba@x.com');
    const body = (await import('node:fs')).readFileSync(credPath, 'utf8');
    expect(body).toContain('heba@x.com\tTHERAPIST/PT\tAdminPw-1');
  });

  it('dry-run writes nothing', async () => {
    reset();
    const dir = makeDataDir();
    const credPath = join(dir, 'creds.txt');
    const { client } = fakeDb();
    await runFoundationSeed({ ...baseArgs(dir, credPath), apply: false }, client);
    expect(created).toHaveLength(0);
    expect(() => statSync(credPath)).toThrow();
  });
});
