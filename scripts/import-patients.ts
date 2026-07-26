#!/usr/bin/env tsx
/**
 * Prompt 52 — the one-off 257-patient production import (110 adults +
 * 147 children) per the SIGNED Prompt-51 mapping in
 * lib/intake/import-mapping.ts. ETL apply only — zero modeling decisions
 * live here.
 *
 * Usage:
 *   pnpm tsx scripts/import-patients.ts --data-dir=$HOME/import-data --dry-run
 *   pnpm tsx scripts/import-patients.ts --data-dir=$HOME/import-data --apply \
 *     --backup-confirmed=<fresh backup path>
 *
 * Owner-signed mechanics:
 * - Leaner direct path (NOT createPatient): no WhatsApp sends, no temp
 *   passwords (passwordHash=null → no portal login until explicit reset),
 *   explicit audit row per patient with actorId='system'.
 * - Intake = IntakeAssessment status=COMPLETED, assessedAt=response_date,
 *   assessedById='system' (the import provenance marker).
 * - Idempotency: deterministic ids imp-a-NNN / imp-c-NNN — existing id →
 *   skip. Per-row transaction; re-run completes the remainder.
 * - Unknown adult DOB → sentinel 1900-01-01 + archive note (displays as
 *   '—' via isUnknownDob).
 * - Every unmappable raw value is PRESERVED in the archive question.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { statSync } from 'node:fs';

import type {
  Comorbidity,
  PainSeverity,
  PainStability,
  PainTiming,
  PhysicalActivityLevel,
  ReferralSource,
  SymptomDuration,
} from '@prisma/client';

import { db } from '@/lib/db';
import { ADULT_COLUMN_MAP, CHILD_COLUMN_MAP, IMPORT_QUESTIONS } from '@/lib/intake/import-mapping';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

import { parseCsv } from '@/lib/format/csv';

export const UNKNOWN_DOB_SENTINEL = '1900-01-01';

// ─── Enum transforms (P51 report — historical AR values verified against
// the real distributions) ──────────────────────────────────────────────────

const ACTIVITY: Record<string, PhysicalActivityLevel> = {
  'نشيط جدا': 'VERY_ACTIVE',
  نشيط: 'ACTIVE',
  متوسط: 'MODERATE',
  'قليل النشاط': 'LOW',
  'غير نشيط': 'INACTIVE',
};
const TIMING: Record<string, PainTiming> = {
  'أثناء النهار': 'DAY',
  'في الليل': 'NIGHT',
  'طوال الوقت': 'ALL_TIME',
  'أثناء النوم': 'DURING_SLEEP',
};
const DURATION: Record<string, SymptomDuration> = {
  'أسبوع او أقل': 'LTE_1_WEEK',
  '2-3 أسابيع': 'WEEKS_2_3',
  '1-3 أشهر': 'MONTHS_1_3',
  '3-6 أشهر': 'MONTHS_3_6',
  'أكثر من 6 أشهر': 'GT_6_MONTHS',
};
const SEVERITY: Record<string, PainSeverity> = {
  '0\\10': 'ZERO',
  '1-2\\10': 'ONE_TWO',
  '3-4\\10': 'THREE_FOUR',
  '5\\10': 'FIVE',
  '6-7\\10': 'SIX_SEVEN',
  '8-9\\10': 'EIGHT_NINE',
  '10\\10': 'TEN',
};
const STABILITY: Record<string, PainStability> = {
  'يزداد الألم مع الوقت': 'WORSENING',
  'الألم ثابت منذ احساسي به لأول مرة': 'CONSTANT',
  'يقل ألمي مع الوقت': 'IMPROVING',
  'أحيانا يزداد وأحيانا يقل حسب أسلوب حياتي': 'VARIABLE',
};
const COMORBIDITY: Record<string, Comorbidity> = {
  ضغط: 'HYPERTENSION',
  سكري: 'DIABETES',
  'نشاط الغدة الدرقية أو خمولها': 'THYROID',
  'هشاشة العظام': 'OSTEOPOROSIS',
  'التهابات المفاصل': 'ARTHRITIS',
  السرطان: 'CANCER',
  'جلطات دماغية': 'CEREBRAL_CLOT',
  'جلطات قلبية رئوية': 'CARDIO_PULMONARY_CLOT',
  'تجلطات في الأطراف': 'LIMB_CLOT',
  'لا يوجد': 'NONE',
  أخرى: 'OTHER',
};

export function mapReferralKeywords(raw: string): { value: ReferralSource; exact: boolean } {
  const t = raw.trim().toLowerCase();
  if (!t) return { value: 'OTHER', exact: true }; // empty → OTHER, nothing to preserve
  if (/صديق|صاحب|اخت|أخت|اخو|أخو|قريب|اهل|أهل|عائل|زوج|امي|أمي|ابن|بنت|توتي|friend/.test(t))
    return { value: 'FRIEND_FAMILY', exact: /^(صديق|عن طريق صديق)$/.test(raw.trim()) };
  if (/سوشيال|فيس|انستا|إنستا|تيك|facebook|instagram|social|tiktok/.test(t))
    return { value: 'SOCIAL_MEDIA', exact: false };
  if (/google|جوجل|قوقل|بحث/.test(t)) return { value: 'GOOGLE_SEARCH', exact: t === 'google' };
  if (/دكتور|طبيب|دكتوره|doctor|مستشفى/.test(t)) return { value: 'DOCTOR_REFERRAL', exact: false };
  return { value: 'OTHER', exact: false };
}

/** "2.0"→2, "لا يوجد"→0, "واحد/اخت واحدة"→1, "الاول"→1 … null = unparsable. */
export function parseIntArabic(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const num = Number(t);
  if (Number.isFinite(num)) return Math.trunc(num);
  const norm = t.replace(/[إأآا]/g, 'ا');
  if (/لا يوجد|لايوجد|ما في/.test(norm)) return 0;
  if (/واحد|الاول|الأول|وحده|وحدة/.test(norm)) return 1;
  if (/اثنين|الثاني|ثنتين/.test(norm)) return 2;
  if (/ثلاث|الثالث/.test(norm)) return 3;
  if (/اربع|الرابع/.test(norm)) return 4;
  if (/خمس|الخامس/.test(norm)) return 5;
  const digit = norm.match(/\d+/);
  if (digit) return Number(digit[0]);
  return null;
}

// ─── Custom-question option resolution (canonical value = opt-<index>) ─────

const questionByKey = new Map(IMPORT_QUESTIONS.map((q) => [q.key, q]));

function optionValueForToken(questionKey: string, token: string): string | null {
  const q = questionByKey.get(questionKey);
  if (!q?.options) return null;
  const i = q.options.findIndex((o) => o.valueAr === token.trim());
  return i >= 0 ? `opt-${i}` : null;
}

// ─── Row model ─────────────────────────────────────────────────────────────

interface Counters {
  createdPatients: number;
  skippedExisting: number;
  phoneNull: number;
  /** Non-Jordanian/mistyped historical numbers → phone=null, raw archived. */
  phoneInvalid: number;
  dobSentinel: number;
  fixedFieldAnswers: number;
  customAnswers: Record<string, number>;
  archiveAnswers: number;
  enumHits: number;
  enumFallbacks: number;
  referralExact: number;
  referralKeyword: number;
  failures: Array<{ id: string; error: string }>;
}

function newCounters(): Counters {
  return {
    createdPatients: 0,
    skippedExisting: 0,
    phoneNull: 0,
    phoneInvalid: 0,
    dobSentinel: 0,
    fixedFieldAnswers: 0,
    customAnswers: {},
    archiveAnswers: 0,
    enumHits: 0,
    enumFallbacks: 0,
    referralExact: 0,
    referralKeyword: 0,
    failures: [],
  };
}

interface PreparedRow {
  id: string;
  type: 'ADULT' | 'PEDIATRIC';
  nameAr: string;
  phone: string | null;
  gender: 'MALE' | 'FEMALE';
  dob: Date;
  dobIsSentinel: boolean;
  occupation: string | null;
  address: string | null;
  responseDate: Date;
  adult?: Record<string, unknown>;
  pediatric?: { numberOfSiblings: number; birthOrder: number };
  /** questionKey → {value} | {values: canonicalOrVerbatim[]} */
  custom: Array<{ questionKey: string; value?: string; values?: string[] }>;
  archiveParts: string[];
}

function firstOfMulti(raw: string): string {
  return raw.split(',')[0]!.trim();
}

function mapEnum<T>(
  table: Record<string, T>,
  raw: string,
  counters: Counters,
  archive: string[],
  label: string,
  fallback: T,
): T {
  const first = firstOfMulti(raw);
  const hit = table[first];
  if (hit !== undefined) {
    counters.enumHits += 1;
    // A multi-valued single: preserve the full original when we truncated.
    if (raw.includes(',')) archive.push(`${label} (كامل الإجابة الأصلية): ${raw.trim()}`);
    return hit;
  }
  counters.enumFallbacks += 1;
  if (raw.trim()) archive.push(`${label} (قيمة غير قياسية): ${raw.trim()}`);
  return fallback;
}

export function prepareAdultRow(
  row: Record<string, string>,
  index: number,
  counters: Counters,
): PreparedRow {
  const archive: string[] = [];
  let phone = row.phone_e164?.trim() || null;
  if (phone && !/^\+9627\d{8}$/.test(phone)) {
    // Owner-signed §1.1: broken numbers import as NULL — the raw is
    // preserved for the paper-file follow-up, never silently dropped.
    archive.push(`رقم هاتف غير صالح (استيراد): ${phone}`);
    counters.phoneInvalid += 1;
    phone = null;
  }
  if (!phone) counters.phoneNull += 1;
  const dobRaw = row.dob_approx?.trim();
  const dobIsSentinel = !dobRaw;
  if (dobIsSentinel) {
    counters.dobSentinel += 1;
    archive.push('تاريخ الميلاد غير معروف — استيراد؛ يُستكمل من الملف الورقي.');
  }
  const note = row['ملاحظة للمراجعة']?.trim();
  if (note) archive.push(`ملاحظة للمراجعة: ${note}`);

  const referralRaw = row['كيف عرفت عن المركز الأول للعلاج الطبيعي'] ?? '';
  const referral = mapReferralKeywords(referralRaw);
  if (referral.exact) counters.referralExact += 1;
  else {
    counters.referralKeyword += 1;
    if (referralRaw.trim()) archive.push(`كيف عرفت عن المركز (النص الأصلي): ${referralRaw.trim()}`);
  }

  // Comorbidities: every token mapped; unknown tokens preserved.
  const condTokens = (row['هل تعاني أو سبق أن عانيت من أي من الأمراض التالية؟'] ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const conditions: Comorbidity[] = [];
  for (const t of condTokens) {
    const m = COMORBIDITY[t];
    if (m) {
      if (!conditions.includes(m)) conditions.push(m);
      counters.enumHits += 1;
    } else {
      counters.enumFallbacks += 1;
      if (!conditions.includes('OTHER')) conditions.push('OTHER');
      archive.push(`الأمراض (قيمة غير قياسية): ${t}`);
    }
  }

  const adult: Record<string, unknown> = {
    physicalActivityLevel: mapEnum(
      ACTIVITY,
      row['مستوى النشاط البدني'] ?? '',
      counters,
      archive,
      'مستوى النشاط',
      'MODERATE',
    ),
    medicalDiagnosis: row['التشخيص الطبي (تشخيص الطبيب الخاص بك)']?.trim() || null,
    primaryComplaint: row['الشكوى الأساسية لديك \\من ماذا تعاني؟']?.trim() || 'غير مذكور (استيراد)',
    painTiming: mapEnum(
      TIMING,
      row['متى يزداد ألمك؟'] ?? '',
      counters,
      archive,
      'متى يزداد الألم',
      'ALL_TIME',
    ),
    symptomDuration: mapEnum(
      DURATION,
      row['منذ متى تعاني من الأعراض التي لديك؟'] ?? '',
      counters,
      archive,
      'مدة الأعراض',
      'GT_6_MONTHS',
    ),
    painSeverity: mapEnum(
      SEVERITY,
      row['كم تصف شدة ألمك من 10؟ (10 هو أكبر ألم ممكن أن تشعر به, و0 هو عدم ا لشعور بالألم'] ?? '',
      counters,
      archive,
      'شدة الألم',
      'FIVE',
    ),
    painAggravatingFactors: row['ما هي الأشياء والوضعيات التي تزيد الألم لديك؟']?.trim() || null,
    painRelievingFactors: row['ما هي الأشياء والوضعيات التي تفعلها لتخفيف الألم؟']?.trim() || null,
    painStability: mapEnum(
      STABILITY,
      row['كيف تصف استقرار الألم لديك؟'] ?? '',
      counters,
      archive,
      'استقرار الألم',
      'VARIABLE',
    ),
    currentMedicationsForProblem:
      row['هل تتناول أي نوع من الأدوية بما يخص مشكلتك الحالية؟, اذكرها']?.trim() || null,
    otherMedications: row['هل تتناول أي أدوية تخص حالة مرضية أخرى؟ اذكرها']?.trim() || null,
    conditions,
    otherConditions:
      row['هل تعاني من أي أمراض غير المذكورة في السؤال السابق؟ اذكرها']?.trim() || null,
    previousFractures: row['هل سبق أن تعرضت لأي كسر؟ اذكر مكان الكسر']?.trim() || null,
    previousSurgeries: row['هل سبق أن خضعت لعملية؟ اذكرها واذكر تاريخها']?.trim() || null,
    previousPtExperience:
      row['هل سبق أن أخذت جلسات علاج طبيعي؟ (اذا كانت الاجابة نعم كيف تصف تجربتك؟)']?.trim() ||
      null,
    referralSource: referral.value,
  };
  counters.fixedFieldAnswers += Object.values(adult).filter(
    (v) => v !== null && !(Array.isArray(v) && v.length === 0),
  ).length;

  return {
    id: `imp-a-${String(index + 1).padStart(3, '0')}`,
    type: 'ADULT',
    nameAr: row.full_name_ar!.trim(),
    phone,
    gender: row.gender === 'MALE' ? 'MALE' : 'FEMALE',
    dob: new Date(`${dobRaw || UNKNOWN_DOB_SENTINEL}T00:00:00Z`),
    dobIsSentinel,
    occupation: row.occupation?.trim() || null,
    address: row.address?.trim() || null,
    responseDate: new Date(row.response_date!.trim() || Date.now()),
    adult,
    custom: [],
    archiveParts: archive,
  };
}

export function prepareChildRow(
  row: Record<string, string>,
  index: number,
  counters: Counters,
): PreparedRow {
  const archive: string[] = [];
  let phone = row.phone_e164?.trim() || null;
  if (phone && !/^\+9627\d{8}$/.test(phone)) {
    archive.push(`رقم هاتف غير صالح (استيراد): ${phone}`);
    counters.phoneInvalid += 1;
    phone = null;
  }
  if (!phone) counters.phoneNull += 1;
  const note = row['ملاحظة للمراجعة']?.trim();
  if (note) archive.push(`ملاحظة للمراجعة: ${note}`);

  const sib = parseIntArabic(row['كم اخ للطفل'] ?? '');
  if (sib === null && row['كم اخ للطفل']?.trim()) {
    archive.push(`كم اخ للطفل (نص أصلي): ${row['كم اخ للطفل']!.trim()}`);
  }
  const order = parseIntArabic(row['ترتيب الطفل بين اخوته'] ?? '');
  if (order === null && row['ترتيب الطفل بين اخوته']?.trim()) {
    archive.push(`ترتيب الطفل (نص أصلي): ${row['ترتيب الطفل بين اخوته']!.trim()}`);
  }

  const custom: PreparedRow['custom'] = [];
  for (const [header, dest] of Object.entries(CHILD_COLUMN_MAP)) {
    if (dest.kind !== 'CUSTOM_QUESTION') continue;
    const raw = row[header]?.trim();
    if (!raw) continue;
    const q = questionByKey.get(dest.questionKey)!;
    if (q.type === 'SINGLE_SELECT' || q.type === 'MULTI_SELECT') {
      const tokens =
        q.type === 'MULTI_SELECT'
          ? raw
              .split(',')
              .map((t) => t.replace(/^\s*•\s*/, '').trim())
              .filter(Boolean)
          : [raw.replace(/^\s*•\s*/, '').trim()];
      const values = tokens.map((t) => {
        const v = optionValueForToken(dest.questionKey, t);
        if (v) {
          counters.enumHits += 1;
          return v;
        }
        counters.enumFallbacks += 1;
        return t; // out-of-options historical value stored VERBATIM
      });
      custom.push({ questionKey: dest.questionKey, values });
    } else {
      custom.push({ questionKey: dest.questionKey, value: raw });
    }
    counters.customAnswers[dest.questionKey] = (counters.customAnswers[dest.questionKey] ?? 0) + 1;
  }

  return {
    id: `imp-c-${String(index + 1).padStart(3, '0')}`,
    type: 'PEDIATRIC',
    nameAr: row.child_name_ar!.trim(),
    phone,
    gender: row.gender === 'MALE' ? 'MALE' : 'FEMALE',
    dob: new Date(`${row.dob!.trim()}T00:00:00Z`),
    dobIsSentinel: false,
    occupation: null,
    address: null,
    responseDate: new Date(row.response_date!.trim() || Date.now()),
    pediatric: { numberOfSiblings: sib ?? 0, birthOrder: order ?? 1 },
    custom,
    archiveParts: archive,
  };
}

// ─── Write one prepared row (per-row transaction) ──────────────────────────

async function writeRow(
  r: PreparedRow,
  questionIdByKey: Map<string, string>,
  prisma: typeof db,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: r.id,
        email: null,
        phone: r.phone,
        role: 'PATIENT',
        fullNameEn: '',
        fullNameAr: r.nameAr,
        languagePref: 'AR',
        passwordHash: null, // no portal login until an explicit reset
        mustChangePassword: false,
      },
    });
    await tx.patientProfile.create({
      data: {
        userId: r.id,
        dateOfBirth: r.dob,
        gender: r.gender,
        occupation: r.occupation,
        address: r.address,
      },
    });
    const intake = await tx.intakeAssessment.create({
      data: {
        patientId: r.id,
        type: r.type,
        status: 'COMPLETED',
        assessedAt: r.responseDate,
        assessedById: SYSTEM_USER_ID,
      },
      select: { id: true },
    });
    if (r.type === 'ADULT') {
      await tx.adultIntakeData.create({
        data: { intakeId: intake.id, ...(r.adult as object) } as never,
      });
    } else {
      await tx.pediatricIntakeData.create({
        data: { intakeId: intake.id, ...r.pediatric! },
      });
    }
    for (const c of r.custom) {
      const qid = questionIdByKey.get(c.questionKey);
      if (!qid) throw new Error(`question not seeded: ${c.questionKey}`);
      await tx.intakeCustomAnswer.create({
        data: {
          intakeId: intake.id,
          questionId: qid,
          value: c.value ?? null,
          valueOptions: c.values ?? undefined,
        },
      });
    }
    if (r.archiveParts.length > 0) {
      const qid = questionIdByKey.get('importArchiveNote');
      if (!qid) throw new Error('archive question not seeded');
      await tx.intakeCustomAnswer.create({
        data: {
          intakeId: intake.id,
          questionId: qid,
          value: r.archiveParts.join('\n'),
          valueOptions: undefined,
        },
      });
    }
    // ONE audit row per created patient, system actor (spec §1.6).
    await tx.auditLog.create({
      data: {
        actorId: SYSTEM_USER_ID,
        entityType: 'User',
        entityId: r.id,
        action: 'CREATE',
        after: { event: 'PATIENT_IMPORTED', source: 'google-forms-2024', intakeId: intake.id },
      },
    });
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean;
  dataDir: string;
  backupPath: string | null;
}

export async function runImport(args: CliArgs, prisma: typeof db = db): Promise<Counters> {
  if (args.apply) {
    if (!args.backupPath) throw new Error('--apply requires --backup-confirmed=<path>');
    const st = statSync(args.backupPath);
    if (!st.isFile() || st.size === 0) throw new Error(`backup invalid: ${args.backupPath}`);
  }

  const adultsRaw = parseCsv(readFileSync(join(args.dataDir, '3-patients-adults.csv'), 'utf8'));
  const childrenRaw = parseCsv(readFileSync(join(args.dataDir, '4-patients-children.csv'), 'utf8'));

  // Header completeness — the mapping must cover every column (P51 seam).
  for (const [rows, map, label] of [
    [adultsRaw, ADULT_COLUMN_MAP, 'adults'],
    [childrenRaw, CHILD_COLUMN_MAP, 'children'],
  ] as const) {
    const headers = Object.keys(rows[0] ?? {});
    const unmapped = headers.filter((h) => !(h in map));
    if (unmapped.length > 0) {
      throw new Error(`${label}: unmapped columns — STOP: ${unmapped.join(' | ')}`);
    }
  }

  const counters = newCounters();
  const prepared: PreparedRow[] = [
    ...adultsRaw.map((r, i) => prepareAdultRow(r, i, counters)),
    ...childrenRaw.map((r, i) => prepareChildRow(r, i, counters)),
  ];

  // Resolve seeded question ids by nameAr (the seed's idempotency key).
  const questionIdByKey = new Map<string, string>();
  const seeded = await prisma.intakeCustomQuestion.findMany({
    select: { id: true, nameAr: true },
  });
  const idByNameAr = new Map(seeded.map((q) => [q.nameAr, q.id]));
  for (const q of IMPORT_QUESTIONS) {
    const id = idByNameAr.get(q.nameAr);
    if (id) questionIdByKey.set(q.key, id);
  }
  const neededKeys = new Set<string>(['importArchiveNote']);
  for (const r of prepared) for (const c of r.custom) neededKeys.add(c.questionKey);
  for (const k of neededKeys) {
    if (!questionIdByKey.has(k)) {
      throw new Error(
        `STOP: custom question not seeded on this DB: ${k} (run seed-intake-questions)`,
      );
    }
  }

  const existing = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: prepared.map((r) => r.id) } },
        select: { id: true },
      })
    ).map((u) => u.id),
  );

  const toCreate = prepared.filter((r) => !existing.has(r.id));
  counters.skippedExisting = prepared.length - toCreate.length;
  counters.archiveAnswers = toCreate.filter((r) => r.archiveParts.length > 0).length;

  const adultsToCreate = toCreate.filter((r) => r.type === 'ADULT').length;
  const childrenToCreate = toCreate.length - adultsToCreate;

  console.log(`\n── ${args.apply ? 'APPLYING IMPORT' : 'DRY RUN — nothing will be written'} ──`);
  console.log(`rows read:            adults=${adultsRaw.length} children=${childrenRaw.length}`);
  console.log(
    `patients to create:   ${toCreate.length} (adults=${adultsToCreate} children=${childrenToCreate})`,
  );
  console.log(`already imported:     ${counters.skippedExisting} (idempotent skip)`);
  console.log(
    `phone null:           ${counters.phoneNull} (empty=${counters.phoneNull - counters.phoneInvalid} + broken-archived=${counters.phoneInvalid})`,
  );
  console.log(`dob sentinel (1900):  ${counters.dobSentinel}`);
  console.log(`adult fixed-field answers: ${counters.fixedFieldAnswers}`);
  console.log(
    `enum transforms:      hits=${counters.enumHits} fallbacks-to-archive=${counters.enumFallbacks}`,
  );
  console.log(
    `referral mapping:     exact=${counters.referralExact} keyword/other(raw archived)=${counters.referralKeyword}`,
  );
  console.log(`rows with archive answer: ${counters.archiveAnswers}`);
  console.log('custom-question answer counts:');
  for (const [k, n] of Object.entries(counters.customAnswers).sort()) {
    console.log(`  ${k.padEnd(32)} ${n}`);
  }
  console.log('skipped rows (expected ZERO beyond idempotent):  none');

  if (!args.apply) return counters;

  let done = 0;
  for (const r of toCreate) {
    try {
      await writeRow(r, questionIdByKey, prisma);
      counters.createdPatients += 1;
    } catch (err) {
      counters.failures.push({
        id: r.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    done += 1;
    if (done % 25 === 0) console.log(`  … ${done}/${toCreate.length} rows processed`);
  }

  // Post-import verification (spec §3).
  const totalPatients = await prisma.user.count({ where: { role: 'PATIENT', deletedAt: null } });
  const importedAdults = await prisma.user.count({ where: { id: { startsWith: 'imp-a-' } } });
  const importedChildren = await prisma.user.count({ where: { id: { startsWith: 'imp-c-' } } });
  const phoneNullDb = await prisma.user.count({
    where: { role: 'PATIENT', phone: null, deletedAt: null },
  });
  const archiveQ = idByNameAr.get('ملاحظات الاستيراد (أرشيف)');
  const archiveCount = archiveQ
    ? await prisma.intakeCustomAnswer.count({ where: { questionId: archiveQ } })
    : 0;

  console.log('\n── POST-IMPORT VERIFICATION ──');
  console.log(`created this run:     ${counters.createdPatients}`);
  console.log(`total patients:       ${totalPatients}`);
  console.log(`imported adults:      ${importedAdults} (expect 110)`);
  console.log(`imported children:    ${importedChildren} (expect 147)`);
  console.log(`phone-null patients:  ${phoneNullDb} (expect 28 = 15 empty + 13 broken)`);
  console.log(`archive answers:      ${archiveCount} (> 0 expected)`);
  if (counters.failures.length > 0) {
    console.error(`\nFAILED ROWS (${counters.failures.length}) — re-run to complete:`);
    for (const f of counters.failures) console.error(`  ${f.id}: ${f.error}`);
  }
  return counters;
}

if (process.argv[1]?.endsWith('import-patients.ts')) {
  const argv = process.argv.slice(2);
  const dataDirArg = argv.find((a) => a.startsWith('--data-dir='));
  if (!dataDirArg) {
    console.error('--data-dir=<path> is required');
    process.exit(1);
  }
  runImport({
    apply: argv.includes('--apply'),
    dataDir: dataDirArg.split('=')[1]!,
    backupPath: argv.find((a) => a.startsWith('--backup-confirmed='))?.split('=')[1] ?? null,
  })
    .then((c) => process.exit(c.failures.length > 0 ? 1 : 0))
    .catch((err) => {
      console.error(`[import] REFUSED/FAILED: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
