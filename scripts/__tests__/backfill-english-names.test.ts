import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';

import { normalizeName, parseReviewedCsv, runBackfill } from '../backfill-english-names';

/**
 * P49 Phase 2 — synthetic fixtures only (never real patient rows). Pins the
 * non-negotiable guards: write-only-where-empty, nameAr untouched,
 * validate-then-write (any reject aborts with zero writes), dry-run default,
 * audit per write, idempotency.
 */

interface FakeUser {
  id: string;
  role: string;
  fullNameEn: string;
  fullNameAr: string;
}

const state: { users: FakeUser[]; audits: Array<Record<string, unknown>> } = {
  users: [],
  audits: [],
};

const fakeDb = {
  user: {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      state.users.filter((u) => where.id.in.includes(u.id)),
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) => {
      const u = state.users.find((x) => x.id === where.id)!;
      Object.assign(u, data);
      return u;
    },
  },
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.audits.push(data);
      return {};
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
} as unknown as PrismaClient;

function csvFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'p49-'));
  const p = join(dir, 'reviewed.csv');
  writeFileSync(p, content, 'utf8');
  return p;
}

beforeEach(() => {
  state.users = [
    { id: 'imp-a-001', role: 'PATIENT', fullNameEn: '', fullNameAr: 'سارة خليل' },
    { id: 'imp-c-002', role: 'PATIENT', fullNameEn: '', fullNameAr: 'لينا الطفلة' },
    { id: 'p-old-7', role: 'PATIENT', fullNameEn: 'Existing Name', fullNameAr: 'قديم' },
    { id: 'staff-1', role: 'THERAPIST', fullNameEn: 'Ahmad Mansour', fullNameAr: 'أحمد منصور' },
  ];
  state.audits = [];
});

describe('parseReviewedCsv', () => {
  it('parses id,nameEn with a BOM + header and normalizes whitespace', () => {
    const { rows, rejects } = parseReviewedCsv('﻿id,nameEn\r\na1,  Sara   Khalil \r\n');
    expect(rejects).toHaveLength(0);
    expect(rows).toEqual([{ id: 'a1', nameEn: 'Sara Khalil' }]);
  });

  it('rejects empty names, Arabic script, non-Latin values, and bad rows', () => {
    const { rows, rejects } = parseReviewedCsv(
      ['id,nameEn', 'a1,', 'a2,سارة', 'a3,12345', 'justoneCell', 'a4,Sara'].join('\n'),
    );
    expect(rows).toEqual([{ id: 'a4', nameEn: 'Sara' }]);
    expect(rejects.map((r) => r.reason).sort()).toEqual([
      'ARABIC_SCRIPT',
      'BAD_ROW',
      'EMPTY_NAME',
      'NOT_LATIN',
    ]);
  });

  it('rejects EVERY occurrence of a duplicate id (the script never picks a winner)', () => {
    const { rows, rejects } = parseReviewedCsv('id,nameEn\na1,Sara One\na1,Sara Two\na2,Ok Name');
    expect(rows).toEqual([{ id: 'a2', nameEn: 'Ok Name' }]);
    expect(rejects.filter((r) => r.reason === 'DUPLICATE_ID')).toHaveLength(2);
  });

  it('normalizeName never alters the reviewed spelling', () => {
    expect(normalizeName('  Abdulrahman   Al-Momani ')).toBe('Abdulrahman Al-Momani');
    expect(normalizeName('mohammad')).toBe('mohammad'); // no "improvement"
  });
});

describe('runBackfill — guards', () => {
  it('dry-run (default) plans WRITE/SKIP but writes nothing', async () => {
    const p = csvFile('id,nameEn\nimp-a-001,Sara Khalil\np-old-7,Should Not Overwrite');
    const r = await runBackfill({ csvPath: p, apply: false }, fakeDb);
    expect(r.rejects).toHaveLength(0);
    expect(r.plan.map((x) => x.action)).toEqual(['WRITE', 'SKIP-has-name']);
    expect(r.written).toBe(0);
    expect(state.users[0]!.fullNameEn).toBe('');
    expect(state.audits).toHaveLength(0);
  });

  it('apply writes ONLY empty-English targets, audits each, and never touches nameAr', async () => {
    const p = csvFile('id,nameEn\nimp-a-001,Sara Khalil\nimp-c-002,Lina Child\np-old-7,Nope');
    const r = await runBackfill({ csvPath: p, apply: true }, fakeDb);
    expect(r.written).toBe(2);
    expect(r.skipped).toBe(1);
    expect(state.users[0]).toMatchObject({ fullNameEn: 'Sara Khalil', fullNameAr: 'سارة خليل' });
    expect(state.users[1]).toMatchObject({ fullNameEn: 'Lina Child', fullNameAr: 'لينا الطفلة' });
    // The pre-existing English name is protected.
    expect(state.users[2]!.fullNameEn).toBe('Existing Name');
    // One audit row per write, system actor, P49 event tag, before/after.
    expect(state.audits).toHaveLength(2);
    expect(state.audits[0]).toMatchObject({
      actorId: 'system',
      entityType: 'User',
      entityId: 'imp-a-001',
      action: 'UPDATE',
      before: { fullNameEn: '' },
      after: { event: 'P49_ENGLISH_NAME_BACKFILL', fullNameEn: 'Sara Khalil' },
    });
  });

  it('second apply is a no-op (everything becomes SKIP-has-name)', async () => {
    const p = csvFile('id,nameEn\nimp-a-001,Sara Khalil');
    await runBackfill({ csvPath: p, apply: true }, fakeDb);
    const second = await runBackfill({ csvPath: p, apply: true }, fakeDb);
    expect(second.written).toBe(0);
    expect(second.plan[0]!.action).toBe('SKIP-has-name');
    expect(state.audits).toHaveLength(1); // no new audit rows
  });

  it('an unknown id aborts the WHOLE run before any write', async () => {
    const p = csvFile('id,nameEn\nimp-a-001,Sara Khalil\nghost-1,Ghost Name');
    const r = await runBackfill({ csvPath: p, apply: true }, fakeDb);
    expect(r.rejects.map((x) => x.reason)).toContain('UNKNOWN_ID');
    expect(r.written).toBe(0);
    expect(state.users[0]!.fullNameEn).toBe(''); // nothing written
    expect(state.audits).toHaveLength(0);
  });

  it('a non-patient id is rejected and aborts', async () => {
    const p = csvFile('id,nameEn\nstaff-1,Ahmad Whatever');
    const r = await runBackfill({ csvPath: p, apply: true }, fakeDb);
    expect(r.rejects.map((x) => x.reason)).toContain('NOT_A_PATIENT');
    expect(r.written).toBe(0);
  });

  it('an Arabic-script value anywhere in the file aborts with zero writes', async () => {
    const p = csvFile('id,nameEn\nimp-a-001,Sara Khalil\nimp-c-002,لينا');
    const r = await runBackfill({ csvPath: p, apply: true }, fakeDb);
    expect(r.rejects.map((x) => x.reason)).toContain('ARABIC_SCRIPT');
    expect(r.written).toBe(0);
    expect(state.users[0]!.fullNameEn).toBe('');
  });
});
