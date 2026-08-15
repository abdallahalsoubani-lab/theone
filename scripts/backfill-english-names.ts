/**
 * P49 Phase 2 — one-off English-name backfill for the legacy patients.
 *
 * Context: P47 row 8 made English the only DISPLAYED name; 258 of the 265
 * production patients (P50 seed + P52 paper import) had no English name and
 * fell back to their stored Arabic one. The owner + planner transliterated
 * and reviewed the list OFF-line (Jordan-style spelling); this script only
 * writes the reviewed result back.
 *
 *   pnpm tsx scripts/backfill-english-names.ts --dry-run ./p49-reviewed.csv
 *   pnpm tsx scripts/backfill-english-names.ts --apply   ./p49-reviewed.csv
 *
 * Input CSV: `id,nameEn` (UTF-8, BOM tolerated).
 *
 * Safety (non-negotiable):
 *   - VALIDATE-THEN-WRITE: an unknown id, a duplicate id, an empty name, or
 *     a name containing Arabic script REJECTS the whole file — the script
 *     aborts before writing anything.
 *   - Only patients whose English name is CURRENTLY EMPTY are written. A row
 *     whose target already has one is SKIPPED and reported, never
 *     overwritten (protects the original 7 English-named patients and any
 *     name the clinic filled manually since the Phase-1 export).
 *   - `fullNameAr` is NEVER touched (P47 decision — the Arabic fallback and
 *     the reversal path stay intact).
 *   - Whitespace is trimmed/collapsed; the reviewed spelling is otherwise
 *     written EXACTLY as provided (no "improvements").
 *   - Default is a DRY RUN; --apply is required to write. Writes run in one
 *     transaction with one audit row per patient (actorId = the reserved
 *     'system' user — AuditLog.actorId is a required FK, so the P49 marker
 *     lives in the after.event tag, same convention as the P52 importer).
 *   - Idempotent: a second --apply finds every target filled → all SKIP.
 */

import { readFileSync } from 'node:fs';

import { PrismaClient, UserRole } from '@prisma/client';

import { SYSTEM_USER_ID } from '@/lib/system/actor';

export interface ReviewedRow {
  id: string;
  nameEn: string;
}

export interface PlanRow {
  id: string;
  nameAr: string;
  nameEn: string;
  action: 'WRITE' | 'SKIP-has-name';
  existingEn?: string;
}

export interface RejectRow {
  line: number;
  id: string;
  value: string;
  reason:
    | 'EMPTY_NAME'
    | 'ARABIC_SCRIPT'
    | 'NOT_LATIN'
    | 'UNKNOWN_ID'
    | 'DUPLICATE_ID'
    | 'NOT_A_PATIENT'
    | 'BAD_ROW';
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
/** Plausibly-Latin: must contain at least one A–Z letter. */
const LATIN_RE = /[A-Za-z]/;

/** Trim + collapse internal whitespace. Never changes letters/spelling. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Minimal RFC-4180-ish parser for the two-column file (quoted cells ok). */
export function parseReviewedCsv(text: string): { rows: ReviewedRow[]; rejects: RejectRow[] } {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows: ReviewedRow[] = [];
  const rejects: RejectRow[] = [];

  const parseLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  };

  const startIdx = lines[0]?.toLowerCase().replace(/^﻿/, '').startsWith('id') ? 1 : 0;
  for (let i = startIdx; i < lines.length; i += 1) {
    const cells = parseLine(lines[i]!);
    const lineNo = i + 1;
    if (cells.length < 2) {
      rejects.push({ line: lineNo, id: cells[0] ?? '', value: '', reason: 'BAD_ROW' });
      continue;
    }
    const id = cells[0]!.trim();
    const nameEn = normalizeName(cells.slice(1).join(','));
    if (!id) {
      rejects.push({ line: lineNo, id, value: nameEn, reason: 'BAD_ROW' });
      continue;
    }
    if (!nameEn) {
      rejects.push({ line: lineNo, id, value: nameEn, reason: 'EMPTY_NAME' });
      continue;
    }
    if (ARABIC_RE.test(nameEn)) {
      rejects.push({ line: lineNo, id, value: nameEn, reason: 'ARABIC_SCRIPT' });
      continue;
    }
    if (!LATIN_RE.test(nameEn)) {
      rejects.push({ line: lineNo, id, value: nameEn, reason: 'NOT_LATIN' });
      continue;
    }
    rows.push({ id, nameEn });
  }

  // Duplicate ids reject EVERY occurrence (the reviewer must resolve which
  // spelling wins — the script never picks).
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  const dupIds = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  if (dupIds.size > 0) {
    for (const r of rows.filter((x) => dupIds.has(x.id))) {
      rejects.push({ line: 0, id: r.id, value: r.nameEn, reason: 'DUPLICATE_ID' });
    }
  }
  return { rows: rows.filter((r) => !dupIds.has(r.id)), rejects };
}

export interface BackfillResult {
  plan: PlanRow[];
  rejects: RejectRow[];
  written: number;
  skipped: number;
}

const prismaSingleton = new PrismaClient();

export async function runBackfill(
  args: { csvPath: string; apply: boolean },
  prisma: PrismaClient = prismaSingleton,
): Promise<BackfillResult> {
  const parsed = parseReviewedCsv(readFileSync(args.csvPath, 'utf8'));
  const rejects = [...parsed.rejects];

  // Resolve every id against the live patients (validate-then-write).
  const patients = await prisma.user.findMany({
    where: { id: { in: parsed.rows.map((r) => r.id) } },
    select: { id: true, role: true, fullNameEn: true, fullNameAr: true },
  });
  const byId = new Map(patients.map((p) => [p.id, p]));

  const plan: PlanRow[] = [];
  for (const row of parsed.rows) {
    const p = byId.get(row.id);
    if (!p) {
      rejects.push({ line: 0, id: row.id, value: row.nameEn, reason: 'UNKNOWN_ID' });
      continue;
    }
    if (p.role !== UserRole.PATIENT) {
      rejects.push({ line: 0, id: row.id, value: row.nameEn, reason: 'NOT_A_PATIENT' });
      continue;
    }
    if (p.fullNameEn.trim() !== '') {
      plan.push({
        id: row.id,
        nameAr: p.fullNameAr,
        nameEn: row.nameEn,
        action: 'SKIP-has-name',
        existingEn: p.fullNameEn,
      });
      continue;
    }
    plan.push({ id: row.id, nameAr: p.fullNameAr, nameEn: row.nameEn, action: 'WRITE' });
  }

  // Any validation reject aborts the whole run BEFORE any write.
  if (rejects.length > 0) {
    return { plan, rejects, written: 0, skipped: plan.filter((r) => r.action !== 'WRITE').length };
  }

  const writes = plan.filter((r) => r.action === 'WRITE');
  const skipped = plan.length - writes.length;

  if (!args.apply) {
    return { plan, rejects: [], written: 0, skipped };
  }

  // One transaction: names + their audit rows land (or roll back) together.
  await prisma.$transaction(async (tx) => {
    for (const w of writes) {
      await tx.user.update({
        where: { id: w.id },
        data: { fullNameEn: w.nameEn }, // fullNameAr deliberately untouched
      });
      await tx.auditLog.create({
        data: {
          actorId: SYSTEM_USER_ID,
          entityType: 'User',
          entityId: w.id,
          action: 'UPDATE',
          before: { fullNameEn: '' },
          after: { event: 'P49_ENGLISH_NAME_BACKFILL', fullNameEn: w.nameEn },
        },
      });
    }
  });

  return { plan, rejects: [], written: writes.length, skipped };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) {
    console.error('Pass either --apply or --dry-run, not both.');
    process.exit(1);
  }
  const csvPath = args.find((a) => !a.startsWith('--'));
  if (!csvPath) {
    console.error(
      'Usage: pnpm tsx scripts/backfill-english-names.ts [--dry-run|--apply] <reviewed.csv>',
    );
    process.exit(1);
  }

  console.log(
    `\n[backfill-english-names] mode: ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'} — ${csvPath}\n`,
  );

  const result = await runBackfill({ csvPath, apply });

  if (result.rejects.length > 0) {
    console.error(`REJECTED — ${result.rejects.length} bad row(s); NOTHING was written:\n`);
    for (const r of result.rejects) {
      console.error(`  line ${r.line || '?'} | ${r.id || '(no id)'} | ${r.reason} | ${r.value}`);
    }
    process.exit(1);
  }

  for (const row of result.plan) {
    const arrow = row.action === 'WRITE' ? '→' : '·';
    const note = row.action === 'WRITE' ? 'WRITE' : `SKIP-has-name (${row.existingEn})`;
    console.log(`  ${row.id} | ${row.nameAr} ${arrow} ${row.nameEn} | ${note}`);
  }
  const writes = result.plan.filter((r) => r.action === 'WRITE').length;
  console.log(
    `\nTotals: ${result.plan.length} rows — ${apply ? `${result.written} WRITTEN` : `${writes} would WRITE`}, ${result.skipped} SKIP-has-name, 0 rejects.\n`,
  );
  if (!apply) console.log('Dry run — re-run with --apply to write.\n');
}

const isDirectRun = process.argv[1]?.includes('backfill-english-names');
if (isDirectRun) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prismaSingleton.$disconnect());
}
