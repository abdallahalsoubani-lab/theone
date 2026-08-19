/**
 * P50 (revised) Phase F — roster import from the owner-reviewed workbook.
 *
 *   pnpm tsx scripts/p50-import-patients.ts --file <path>          # dry-run
 *   pnpm tsx scripts/p50-import-patients.ts --file <path> --apply  # write
 *
 * Contract (Prompt 50 revised §6 — owner decisions, verbatim):
 *   - The reviewed workbook sheet «سجلات الاستيراد» is the ONLY source of
 *     truth. THE_ONE.xlsx is never read; nothing is re-derived.
 *   - Refuses to run if the sheet is missing, the row count differs from the
 *     summary sheet, or any row has an empty «القرار».
 *   - Honours «القرار» absolutely: IMPORT / SKIP / MERGE:<key> (a MERGE row is
 *     not created; its review notes fold into the target's archive note).
 *   - COMPLETELY SILENT: no WhatsApp, no credentials, no notification, no
 *     queue job. This file must never import from lib/whatsapp, lib/queue or
 *     lib/notifications (asserted by tests).
 *   - No portal login: passwordHash null, email null, languagePref AR.
 *   - Unknown DOB → the P52 sentinel 1900-01-01. An age in «العمر بالملف» is
 *     preserved in the archive note, NEVER converted into a birthday.
 *   - Phones: non-E.164 values import with phone=null and the raw string
 *     archived. A «+7…» number whose source cell had no country code is a
 *     normalization artifact of a broken Jordanian entry (10 national digits
 *     where Jordan has 9) — also null + archived; adding 962 could produce a
 *     REAL stranger's number (owner ruling #5, 19 Aug).
 *   - Enum verification (owner rulings #4): THYROID_DISORDER→THYROID,
 *     STROKE→CEREBRAL_CLOT (the Arabic source says «جلطات دماغية»), pediatric
 *     VISION→the configured «Visual/بصرية» option; SENSORY and every free-text
 *     value land in the archive note. Never invent an enum value.
 *   - AdultIntakeData / PediatricIntakeData rows are NOT created: their
 *     columns are NOT NULL enums the source cannot fill, and fabricating
 *     values is forbidden. The intake is IN_PROGRESS; diagnosis,
 *     comorbidities (mapped tokens) and everything else are carried in the
 *     archive-note custom answer until the clinic completes the real intake.
 *   - Idempotent: deterministic ids `p50-<row key>`; a second run writes 0.
 *   - One audit row per imported patient + one summary row, actor = system.
 */

import { statSync } from 'node:fs';

import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { addCareTeamMemberTx } from '@/lib/patients/assignment';
import { IMPORT_QUESTIONS } from '@/lib/intake/import-mapping';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

import { readXlsx } from './xlsx-lite';

export const ROSTER_SHEET = 'سجلات الاستيراد';
export const SUMMARY_SHEET = 'الملخص';
export const UNKNOWN_DOB_SENTINEL = '1900-01-01';
const E164 = /^\+[1-9]\d{7,14}$/;

/** Consumed columns (Arabic headers, row 1). Refuse if any is missing. */
const COLUMNS = [
  'مفتاح',
  'النوع',
  'الاسم العربي',
  'الاسم العربي المقترح',
  'الاسم الإنجليزي',
  'الهاتف E.164',
  'الهاتف كما بالملف',
  'الجنس',
  'تاريخ الميلاد النهائي',
  'العمر بالملف',
  'العنوان',
  'الوظيفة',
  'البلد',
  'التشخيص',
  'أمراض مصاحبة (enum)',
  'أمراض نص حر',
  'مشاكل الطفل (enum)',
  'مشاكل نص حر',
  'الحالة',
  'المعالج بالملف',
  'القرار',
  'ملاحظاتك',
] as const;
type ColumnName = (typeof COLUMNS)[number];

/** Owner-approved comorbidity mapping (ruling #4) — workbook token → real Prisma member. */
export const COMORBIDITY_MAP: Record<string, string> = {
  NONE: 'NONE',
  HYPERTENSION: 'HYPERTENSION',
  THYROID_DISORDER: 'THYROID',
  ARTHRITIS: 'ARTHRITIS',
  OTHER: 'OTHER',
  OSTEOPOROSIS: 'OSTEOPOROSIS',
  DIABETES: 'DIABETES',
  STROKE: 'CEREBRAL_CLOT',
  CANCER: 'CANCER',
};

/** Workbook token → configured option id of the «currentProblems» question. */
export const PROBLEMS_OPTION_MAP: Record<string, string> = {
  MOTOR: 'opt-0',
  SPEECH: 'opt-1',
  VISION: 'opt-2', // configured option is «Visual/بصرية» — owner-approved match
  HEARING: 'opt-3',
  COGNITIVE: 'opt-4',
  NONE: 'opt-5',
};

export interface PreparedRow {
  key: string;
  /** Deterministic id — the idempotency key. */
  id: string;
  type: 'ADULT' | 'PEDIATRIC';
  fullNameEn: string;
  fullNameAr: string;
  phone: string | null;
  gender: 'MALE' | 'FEMALE' | null;
  /** ISO date; sentinel when unknown. */
  dateOfBirth: string;
  address: string | null;
  occupation: string | null;
  /** opt-N ids for the currentProblems MULTI_SELECT (pediatric only). */
  problemsOptions: string[];
  archiveNote: string;
  therapistRaw: string | null;
}

export interface PrepareResult {
  prepared: PreparedRow[];
  skipped: string[]; // keys with القرار = SKIP
  merged: Array<{ key: string; into: string }>;
  rejections: Array<{ key: string; reason: string }>;
  brokenPhones: Array<{ key: string; raw: string }>;
}

export function resolvePhone(
  e164Cell: string,
  rawCell: string,
): { phone: string | null; broken: boolean } {
  const v = e164Cell.trim();
  if (!v) return { phone: null, broken: false };
  if (!E164.test(v)) return { phone: null, broken: true };
  // «+7…» with no country code in the source cell = broken Jordanian entry
  // (owner ruling #5) — never a real Russian number, never "add 962".
  if (/^\+7\d+$/.test(v) && !/^\s*(\+|00)\s*7/.test(rawCell.trim())) {
    return { phone: null, broken: true };
  }
  return { phone: v, broken: false };
}

function cellsOf(header: string[], row: string[]): (name: ColumnName) => string {
  const index = new Map(header.map((h, i) => [h.trim(), i] as const));
  return (name) => (row[index.get(name) ?? -1] ?? '').trim();
}

export function prepareRows(sheet: string[][]): PrepareResult {
  const [header, ...data] = sheet;
  if (!header) throw new Error('REFUSED: roster sheet is empty');
  const missing = COLUMNS.filter((c) => !header.some((h) => h.trim() === c));
  if (missing.length > 0) {
    throw new Error(`REFUSED: roster sheet is missing columns: ${missing.join(' | ')}`);
  }

  const result: PrepareResult = {
    prepared: [],
    skipped: [],
    merged: [],
    rejections: [],
    brokenPhones: [],
  };

  // Pass 0 — decisions must all be present; keys must be unique.
  const seenKeys = new Set<string>();
  for (const row of data) {
    const cell = cellsOf(header, row);
    const key = cell('مفتاح');
    const decision = cell('القرار');
    if (!key) throw new Error('REFUSED: a row has an empty «مفتاح»');
    if (seenKeys.has(key)) throw new Error(`REFUSED: duplicate row key ${key}`);
    seenKeys.add(key);
    if (!decision) throw new Error(`REFUSED: row ${key} has an empty «القرار»`);
    if (decision !== 'IMPORT' && decision !== 'SKIP' && !decision.startsWith('MERGE:')) {
      throw new Error(`REFUSED: row ${key} has an unknown «القرار»: ${decision}`);
    }
  }

  // Pass 1 — collect MERGE notes per target.
  const mergeNotes = new Map<string, string[]>();
  for (const row of data) {
    const cell = cellsOf(header, row);
    const decision = cell('القرار');
    if (!decision.startsWith('MERGE:')) continue;
    const key = cell('مفتاح');
    const target = decision.slice('MERGE:'.length).trim();
    const notes = [cell('ملاحظاتك'), cell('أمراض نص حر'), cell('مشاكل نص حر')]
      .filter(Boolean)
      .join(' — ');
    const list = mergeNotes.get(target) ?? [];
    list.push(`مدموج من ${key}${notes ? `: ${notes}` : ''}`);
    mergeNotes.set(target, list);
    result.merged.push({ key, into: target });
  }
  for (const { key, into } of result.merged) {
    const targetRow = data.find((r) => cellsOf(header, r)('مفتاح') === into);
    const targetDecision = targetRow ? cellsOf(header, targetRow)('القرار') : null;
    if (targetDecision !== 'IMPORT') {
      result.rejections.push({
        key,
        reason: `MERGE target ${into} ${targetRow ? `is ${targetDecision}` : 'does not exist'}`,
      });
    }
  }

  // Pass 2 — prepare IMPORT rows.
  for (const row of data) {
    const cell = cellsOf(header, row);
    const key = cell('مفتاح');
    const decision = cell('القرار');
    if (decision === 'SKIP') {
      result.skipped.push(key);
      continue;
    }
    if (decision.startsWith('MERGE:')) continue;

    const type = cell('النوع');
    if (type !== 'ADULT' && type !== 'PEDIATRIC') {
      result.rejections.push({ key, reason: `unknown «النوع»: ${type || '(empty)'}` });
      continue;
    }
    const fullNameEn = cell('الاسم الإنجليزي');
    if (!fullNameEn) {
      result.rejections.push({ key, reason: 'empty «الاسم الإنجليزي»' });
      continue;
    }
    // Prefer the original Arabic name; fall back to the reviewed proposal.
    const fullNameAr = cell('الاسم العربي') || cell('الاسم العربي المقترح');

    const genderCell = cell('الجنس');
    if (genderCell && genderCell !== 'MALE' && genderCell !== 'FEMALE') {
      result.rejections.push({ key, reason: `unknown «الجنس»: ${genderCell}` });
      continue;
    }
    const gender = genderCell === '' ? null : (genderCell as 'MALE' | 'FEMALE');

    const dobCell = cell('تاريخ الميلاد النهائي');
    let dateOfBirth = UNKNOWN_DOB_SENTINEL;
    if (dobCell) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(dobCell) ||
        Number.isNaN(Date.parse(`${dobCell}T00:00:00Z`))
      ) {
        result.rejections.push({ key, reason: `invalid «تاريخ الميلاد النهائي»: ${dobCell}` });
        continue;
      }
      dateOfBirth = dobCell;
    }

    const { phone, broken } = resolvePhone(cell('الهاتف E.164'), cell('الهاتف كما بالملف'));
    if (broken)
      result.brokenPhones.push({ key, raw: cell('الهاتف كما بالملف') || cell('الهاتف E.164') });

    // Comorbidities — mapped tokens (owner ruling #4); unknown tokens are
    // preserved as free text, never invented into an enum.
    const comorbidityTokens = cell('أمراض مصاحبة (enum)')
      .split(/[،,]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const mappedComorbidities: string[] = [];
    const unmappedComorbidities: string[] = [];
    for (const token of comorbidityTokens) {
      const mapped = COMORBIDITY_MAP[token];
      if (mapped) mappedComorbidities.push(mapped);
      else unmappedComorbidities.push(token);
    }

    // Pediatric problems — configured option ids; SENSORY + anything else
    // goes to the archive note (owner ruling #4; intake questions untouched).
    const problemTokens = cell('مشاكل الطفل (enum)')
      .split(/[،,]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const problemsOptions: string[] = [];
    const unmappedProblems: string[] = [];
    for (const token of problemTokens) {
      const opt = PROBLEMS_OPTION_MAP[token];
      if (opt && type === 'PEDIATRIC') problemsOptions.push(opt);
      else unmappedProblems.push(token);
    }

    const noteLines = [
      `استيراد P50 — المفتاح: ${key}`,
      cell('الحالة') && `الحالة بالعيادة: ${cell('الحالة')}`,
      cell('العمر بالملف') && `العمر كما بالملف: ${cell('العمر بالملف')}`,
      cell('التشخيص') && `التشخيص: ${cell('التشخيص')}`,
      mappedComorbidities.length > 0 &&
        `أمراض مصاحبة (مطابقة معتمدة): ${mappedComorbidities.join('، ')}`,
      unmappedComorbidities.length > 0 && `أمراض خارج القائمة: ${unmappedComorbidities.join('، ')}`,
      cell('أمراض نص حر') && `أمراض نص حر: ${cell('أمراض نص حر')}`,
      unmappedProblems.length > 0 && `مشاكل خارج الخيارات: ${unmappedProblems.join('، ')}`,
      cell('مشاكل نص حر') && `مشاكل نص حر: ${cell('مشاكل نص حر')}`,
      cell('البلد') && `البلد: ${cell('البلد')}`,
      cell('المعالج بالملف') && `المعالج بالملف: ${cell('المعالج بالملف')}`,
      broken &&
        `الهاتف كما بالملف (تعذّر اعتماده — راجع القائمة المسلَّمة للعيادة): ${cell('الهاتف كما بالملف') || cell('الهاتف E.164')}`,
      cell('ملاحظاتك') && `ملاحظات المراجعة: ${cell('ملاحظاتك')}`,
      ...(mergeNotes.get(key) ?? []),
    ].filter((l): l is string => Boolean(l));

    result.prepared.push({
      key,
      id: `p50-${key.toLowerCase()}`,
      type,
      fullNameEn,
      fullNameAr,
      phone,
      gender,
      dateOfBirth,
      address: cell('العنوان') || null,
      occupation: cell('الوظيفة') || null,
      problemsOptions,
      archiveNote: noteLines.join('\n'),
      therapistRaw: cell('المعالج بالملف') || null,
    });
  }

  return result;
}

// ─── Therapist matching (best effort; unmatched stays in the note) ─────────

function normalizeName(s: string): string {
  return s
    .replace(/^د\.?\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function matchTherapist(
  raw: string,
  therapists: Array<{ id: string; fullNameEn: string; fullNameAr: string }>,
): string | null {
  const needle = normalizeName(raw);
  if (!needle) return null;
  const hits = therapists.filter((t) => {
    const en = normalizeName(t.fullNameEn);
    const ar = normalizeName(t.fullNameAr);
    return (
      en === needle ||
      ar === needle ||
      (needle.length >= 4 && (en.includes(needle) || ar.includes(needle))) ||
      (en.length >= 4 && needle.includes(en)) ||
      (ar.length >= 4 && needle.includes(ar))
    );
  });
  return hits.length === 1 ? hits[0]!.id : null; // ambiguous or none → no link
}

// ─── Write path — silent, per-row transaction, idempotent ──────────────────

export interface Counters {
  read: number;
  toWrite: number;
  written: number;
  skippedDecision: number;
  merged: number;
  skippedExisting: number;
  rejections: Array<{ key: string; reason: string }>;
  brokenPhones: Array<{ key: string; raw: string }>;
  therapistMatched: number;
  therapistUnmatched: number;
  failures: Array<{ key: string; error: string }>;
}

export async function runImport(
  args: { file: string; apply: boolean },
  prisma: typeof db = db,
): Promise<Counters> {
  const st = statSync(args.file, { throwIfNoEntry: false });
  if (!st?.isFile()) throw new Error(`REFUSED: file not found: ${args.file}`);

  const sheets = readXlsx(args.file);
  const roster = sheets.get(ROSTER_SHEET);
  if (!roster) throw new Error(`REFUSED: sheet «${ROSTER_SHEET}» is missing`);

  // Summary cross-check: total records must equal the data row count.
  const summary = sheets.get(SUMMARY_SHEET);
  const totalRow = summary?.find((r) => (r[0] ?? '').trim() === 'إجمالي السجلات');
  const summaryTotal = totalRow ? Number((totalRow[1] ?? '').trim()) : NaN;
  const dataCount = roster.length - 1;
  if (!Number.isFinite(summaryTotal)) {
    throw new Error(`REFUSED: sheet «${SUMMARY_SHEET}» has no «إجمالي السجلات» row`);
  }
  if (summaryTotal !== dataCount) {
    throw new Error(
      `REFUSED: roster has ${dataCount} data rows but the summary sheet says ${summaryTotal}`,
    );
  }

  const prep = prepareRows(roster);
  const counters: Counters = {
    read: dataCount,
    toWrite: prep.prepared.length,
    written: 0,
    skippedDecision: prep.skipped.length,
    merged: prep.merged.length,
    skippedExisting: 0,
    rejections: prep.rejections,
    brokenPhones: prep.brokenPhones,
    therapistMatched: 0,
    therapistUnmatched: 0,
    failures: [],
  };

  // Custom question ids (seeded by nameAr — the P51 idempotency key).
  const seeded = await prisma.intakeCustomQuestion.findMany({
    select: { id: true, nameAr: true },
  });
  const idByNameAr = new Map(seeded.map((q) => [q.nameAr, q.id]));
  const questionId = (key: string): string => {
    const def = IMPORT_QUESTIONS.find((q) => q.key === key);
    const id = def ? idByNameAr.get(def.nameAr) : undefined;
    if (!id) {
      throw new Error(
        `STOP: custom question not seeded on this DB: ${key} (run seed-intake-questions)`,
      );
    }
    return id;
  };
  const archiveQuestionId = questionId('importArchiveNote');
  const problemsQuestionId = questionId('currentProblems');

  // Idempotency — deterministic ids already imported are skipped.
  const existing = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: prep.prepared.map((r) => r.id) } },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  counters.skippedExisting = prep.prepared.filter((r) => existing.has(r.id)).length;

  // Therapist matching (read-only; reported in dry-run too).
  const therapists = await prisma.user.findMany({
    where: { role: 'THERAPIST', deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true },
  });
  const therapistByRow = new Map<string, string>();
  for (const r of prep.prepared) {
    if (!r.therapistRaw) continue;
    const match = matchTherapist(r.therapistRaw, therapists);
    if (match) {
      therapistByRow.set(r.key, match);
      counters.therapistMatched += 1;
    } else {
      counters.therapistUnmatched += 1;
    }
  }

  report(counters, args.apply);

  if (counters.rejections.length > 0) {
    throw new Error(
      `REFUSED: ${counters.rejections.length} unexplained rejection(s) — fix the workbook, nothing was written`,
    );
  }
  if (!args.apply) return counters;

  const toCreate = prep.prepared.filter((r) => !existing.has(r.id));
  for (const r of toCreate) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: r.id,
            role: 'PATIENT',
            fullNameEn: r.fullNameEn,
            fullNameAr: r.fullNameAr,
            phone: r.phone,
            email: null,
            passwordHash: null, // no portal login (owner decision #2)
            mustChangePassword: false,
            languagePref: 'AR',
          },
        });
        await tx.patientProfile.create({
          data: {
            userId: r.id,
            dateOfBirth: new Date(`${r.dateOfBirth}T00:00:00Z`),
            gender: r.gender,
            address: r.address,
            occupation: r.occupation,
          },
        });
        const intake = await tx.intakeAssessment.create({
          data: {
            patientId: r.id,
            type: r.type,
            status: 'IN_PROGRESS', // owner decision #4 — never COMPLETED
            assessedById: SYSTEM_USER_ID,
          },
          select: { id: true },
        });
        await tx.intakeCustomAnswer.create({
          data: { intakeId: intake.id, questionId: archiveQuestionId, value: r.archiveNote },
        });
        if (r.problemsOptions.length > 0) {
          await tx.intakeCustomAnswer.create({
            data: {
              intakeId: intake.id,
              questionId: problemsQuestionId,
              valueOptions: r.problemsOptions as Prisma.InputJsonValue as never,
            },
          });
        }
        const therapistId = therapistByRow.get(r.key);
        if (therapistId) {
          await addCareTeamMemberTx(tx, r.id, therapistId, SYSTEM_USER_ID);
        }
        await tx.auditLog.create({
          data: {
            actorId: SYSTEM_USER_ID,
            entityType: 'User',
            entityId: r.id,
            action: 'CREATE',
            after: {
              event: 'P50_ROSTER_IMPORT',
              sourceKey: r.key,
              intakeId: intake.id,
              intakeStatus: 'IN_PROGRESS',
            },
          },
        });
      });
      counters.written += 1;
    } catch (err) {
      counters.failures.push({
        key: r.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorId: SYSTEM_USER_ID,
      entityType: 'System',
      entityId: 'p50-roster-import',
      action: 'CREATE',
      after: {
        event: 'P50_ROSTER_IMPORT_SUMMARY',
        read: counters.read,
        written: counters.written,
        skippedDecision: counters.skippedDecision,
        merged: counters.merged,
        skippedExisting: counters.skippedExisting,
        brokenPhones: counters.brokenPhones.map((b) => b.key),
        therapistMatched: counters.therapistMatched,
        therapistUnmatched: counters.therapistUnmatched,
        failures: counters.failures.map((f) => f.key),
      },
    },
  });

  console.log(`\n[apply] written=${counters.written} failures=${counters.failures.length}`);
  if (counters.failures.length > 0) {
    console.error('FAILED ROWS — fix and re-run (idempotent):');
    for (const f of counters.failures) console.error(`  ${f.key}: ${f.error}`);
  }
  return counters;
}

function report(c: Counters, apply: boolean): void {
  console.log(`[p50-import] mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`rows read:          ${c.read}`);
  console.log(
    `rows to write:      ${c.toWrite} (read − SKIP(${c.skippedDecision}) − MERGE(${c.merged}) − rejections(${c.rejections.length}))`,
  );
  console.log(`already imported:   ${c.skippedExisting} (idempotency — will not be re-written)`);
  console.log(`phones nulled:      ${c.brokenPhones.length} broken (raw archived per row)`);
  for (const b of c.brokenPhones) console.log(`   - ${b.key}: raw=${b.raw}`);
  console.log(
    `therapist matched:  ${c.therapistMatched} / unmatched kept in note: ${c.therapistUnmatched}`,
  );
  if (c.rejections.length > 0) {
    console.error(
      `REJECTIONS (${c.rejections.length}) — the picture is wrong; nothing will be written:`,
    );
    for (const r of c.rejections) console.error(`   - ${r.key}: ${r.reason}`);
  }
}

// ─── CLI ───────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('p50-import-patients.ts')) {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith('--file='))?.split('=')[1];
  const sp = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : undefined;
  const file = eq ?? sp;
  if (!file) {
    console.error('--file <path> is required');
    process.exit(1);
  }
  runImport({ file, apply: argv.includes('--apply') })
    .then((c) => process.exit(c.failures.length > 0 || c.rejections.length > 0 ? 1 : 0))
    .catch((err) => {
      console.error(`[p50-import] ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
