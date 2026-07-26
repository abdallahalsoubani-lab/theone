import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runImport, mapReferralKeywords, parseIntArabic } from '../import-patients';
import { displayAgeYears, isUnknownDob } from '@/lib/patients/schemas';

/**
 * P52 §4 — synthetic fixtures ONLY (never real patient rows). The headers
 * are the real header lists; the rows are invented.
 */

const ADULT_HEADERS =
  'response_date,full_name_ar,age,dob_approx,gender,phone_e164,occupation,address,مستوى النشاط البدني,التشخيص الطبي (تشخيص الطبيب الخاص بك),الشكوى الأساسية لديك \\من ماذا تعاني؟,متى يزداد ألمك؟,منذ متى تعاني من الأعراض التي لديك؟,"كم تصف شدة ألمك من 10؟ (10 هو أكبر ألم ممكن أن تشعر به, و0 هو عدم ا لشعور بالألم",ما هي الأشياء والوضعيات التي تزيد الألم لديك؟,ما هي الأشياء والوضعيات التي تفعلها لتخفيف الألم؟,كيف تصف استقرار الألم لديك؟,"هل تتناول أي نوع من الأدوية بما يخص مشكلتك الحالية؟, اذكرها",هل تتناول أي أدوية تخص حالة مرضية أخرى؟ اذكرها,هل تعاني أو سبق أن عانيت من أي من الأمراض التالية؟,هل تعاني من أي أمراض غير المذكورة في السؤال السابق؟ اذكرها,هل سبق أن تعرضت لأي كسر؟ اذكر مكان الكسر,هل سبق أن خضعت لعملية؟ اذكرها واذكر تاريخها,هل سبق أن أخذت جلسات علاج طبيعي؟ (اذا كانت الاجابة نعم كيف تصف تجربتك؟),كيف عرفت عن المركز الأول للعلاج الطبيعي,ملاحظة للمراجعة';

const CHILD_HEADERS =
  'response_date,child_name_ar,gender,dob,phone_e164,كم اخ للطفل,ترتيب الطفل بين اخوته,عمر الام وقت الحمل,مدة الحمل بالاسبوع,نوع الولادة,هل عانيتي من أي صعوبات أو مشاكل خلال الولادة,هل كانت الام تعاني من أي مرض أو أخذت أدوية أو تعرضت لأي نوع من الأشعة خلال فترة الحمل؟,"إذا كانت الاجابة نعم, الرجاء ذكر المرض,الدواء او الاشعة خلال فترة الحمل",وزن الطفل,بكاء الطفل مباشرة بعد ولادته,هل عانى الطفل من أي مشاكل بعد الولادة,هل دخل الطفل وحدة العناية المركزة لحديثي الولاده,"هل عرضتي طفلك على طبيب مختص بالأعصاب , أخصائي أطفال, أو أخصائي عظام و مفاصل, او غير ذلك؟",هل يأخذ طفلك اي علاج او دواء؟,:هل يعاني طفلك أي من المشاكل التالية,هل خضع طفلك لأي عملية؟,هل يعاني أحد اقارب الأم أو الأب من نفس المشكلة ؟,هل يوجد صلة قرابة بين الوالدين,هل أخذ طفلك جلسات علاجيه سابقا؟,هل يعاني طفلك من مشاكل خوف زائده,في اي مرحلة من التطور النمائي تجد طفلك؟,ما هو الدواء الذي يأخذه ابنك بشكل مستمر؟,نوع العملية,ما سبب دخول إبنك وحدة العناية المركزة,كيف عرفت عن المركز (موحّد),ملاحظة للمراجعة';

// The real files are RFC-4180: comma-carrying headers/cells are quoted —
// the fixture headers above mirror that exactly, and the row builders
// quote any cell containing a comma.
const REAL_ADULT_HEADER_ROW = ADULT_HEADERS;
const REAL_CHILD_HEADER_ROW = CHILD_HEADERS;
const q = (v: string) => (v.includes(',') ? `"${v}"` : v);

function adultRow(over: Record<number, string>): string {
  const cells = new Array(26).fill('');
  cells[0] = '2024-03-01';
  cells[1] = 'سناء التجريبية';
  cells[2] = '40';
  cells[3] = '1984-01-01';
  cells[4] = 'FEMALE';
  cells[5] = '+962790000101';
  cells[8] = 'متوسط';
  cells[10] = 'ألم أسفل الظهر';
  cells[11] = 'أثناء النهار';
  cells[12] = 'أكثر من 6 أشهر';
  cells[13] = '6-7\\10';
  cells[16] = 'أحيانا يزداد وأحيانا يقل حسب أسلوب حياتي';
  cells[19] = 'لا يوجد';
  cells[24] = 'Google';
  for (const [i, v] of Object.entries(over)) cells[Number(i)] = v;
  return cells.map(q).join(',');
}

function childRow(over: Record<number, string>): string {
  const cells = new Array(31).fill('');
  cells[0] = '2024-05-01';
  cells[1] = 'طفل تجريبي';
  cells[2] = 'MALE';
  cells[3] = '2020-06-15';
  cells[4] = '+962790000202';
  cells[5] = '2.0';
  cells[6] = '1.0';
  cells[9] = 'قيصرية';
  cells[14] = 'نعم';
  cells[19] = 'حركية';
  for (const [i, v] of Object.entries(over)) cells[Number(i)] = v;
  return cells.map(q).join(',');
}

function makeDataDir(adultRows: string[], childRows: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'p52-import-'));
  writeFileSync(
    join(dir, '3-patients-adults.csv'),
    '﻿' + [REAL_ADULT_HEADER_ROW, ...adultRows].join('\r\n') + '\r\n',
  );
  writeFileSync(
    join(dir, '4-patients-children.csv'),
    '﻿' + [REAL_CHILD_HEADER_ROW, ...childRows].join('\r\n') + '\r\n',
  );
  return dir;
}

// ─── Fake prisma ───────────────────────────────────────────────────────────

function fakeDb(existingIds: string[] = []) {
  const writes = {
    users: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    intakes: [] as Array<Record<string, unknown>>,
    adultData: [] as Array<Record<string, unknown>>,
    pedData: [] as Array<Record<string, unknown>>,
    answers: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
  };
  let intakeSeq = 0;
  const tx = {
    user: {
      create: async ({ data }: { data: Record<string, unknown> }) => (
        writes.users.push(data),
        data
      ),
    },
    patientProfile: {
      create: async ({ data }: { data: Record<string, unknown> }) => (
        writes.profiles.push(data),
        data
      ),
    },
    intakeAssessment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.intakes.push(data);
        return { id: `intake-${++intakeSeq}` };
      },
    },
    adultIntakeData: {
      create: async ({ data }: { data: Record<string, unknown> }) => (
        writes.adultData.push(data),
        data
      ),
    },
    pediatricIntakeData: {
      create: async ({ data }: { data: Record<string, unknown> }) => (
        writes.pedData.push(data),
        data
      ),
    },
    intakeCustomAnswer: {
      create: async ({ data }: { data: Record<string, unknown> }) => (
        writes.answers.push(data),
        data
      ),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => (
        writes.audits.push(data),
        data
      ),
    },
  };
  const client = {
    ...tx,
    $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    intakeCustomQuestion: {
      findMany: async () =>
        (await import('@/lib/intake/import-mapping')).IMPORT_QUESTIONS.map((q) => ({
          id: `q-${q.key}`,
          nameAr: q.nameAr,
        })),
    },
    user: {
      ...tx.user,
      findMany: async () => existingIds.map((id) => ({ id })),
      count: async () => writes.users.length,
    },
    intakeCustomAnswer: {
      ...tx.intakeCustomAnswer,
      count: async () => writes.answers.length,
    },
  };
  return { client: client as never, writes };
}

const backup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'p52-bk-'));
  const p = join(dir, 'b.sql');
  writeFileSync(p, 'x');
  return p;
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('transforms', () => {
  it('referral keywords', () => {
    expect(mapReferralKeywords('عن طريق دكتور محمد').value).toBe('DOCTOR_REFERRAL');
    expect(mapReferralKeywords('صديق')).toEqual({ value: 'FRIEND_FAMILY', exact: true });
    expect(mapReferralKeywords('Facebook').value).toBe('SOCIAL_MEDIA');
    expect(mapReferralKeywords('')).toEqual({ value: 'OTHER', exact: true });
    expect(mapReferralKeywords('من إعلان بالشارع').value).toBe('OTHER');
  });

  it('arabic int coercion', () => {
    expect(parseIntArabic('2.0')).toBe(2);
    expect(parseIntArabic('لا يوجد')).toBe(0);
    expect(parseIntArabic('اخت واحدة')).toBe(1);
    expect(parseIntArabic('الثاني')).toBe(2);
    expect(parseIntArabic('غامض تماما')).toBeNull();
  });

  it('sentinel DOB displays as unknown, never as an age', () => {
    const sentinel = new Date('1900-01-01T00:00:00Z');
    expect(isUnknownDob(sentinel)).toBe(true);
    expect(displayAgeYears(sentinel)).toBeNull();
    expect(isUnknownDob(new Date('1941-01-01T00:00:00Z'))).toBe(false);
    expect(displayAgeYears(new Date('2020-06-15T00:00:00Z'))).toBeGreaterThan(0);
  });
});

describe('runImport (synthetic fixtures)', () => {
  const FIXTURE_ADULTS = [
    adultRow({}), // clean row
    adultRow({
      1: 'ليلى بلا هاتف',
      2: '',
      3: '',
      5: '',
      8: 'متوسط, قليل النشاط',
      24: 'عن طريق الدكتور فلان الفلاني',
    }), // null phone + missing DOB (sentinel) + multi single + keyword referral
    adultRow({ 1: 'هدى', 5: '+962790000103', 19: 'ضغط, مرض نادر جدا', 25: 'راجع الرقم' }),
  ];
  const FIXTURE_CHILDREN = [
    childRow({}),
    childRow({ 1: 'شقيق أول', 4: '+962790000300', 5: 'لا يوجد', 19: 'حركية, Hypotonia' }),
    childRow({ 1: 'شقيق ثاني', 4: '+962790000300', 6: 'الثاني' }), // shared phone
    childRow({ 1: 'طفل بلا هاتف', 4: '' }),
  ];

  it('dry-run writes nothing and reports the expected counters', async () => {
    const dir = makeDataDir(FIXTURE_ADULTS, FIXTURE_CHILDREN);
    const { client, writes } = fakeDb();
    const c = await runImport({ apply: false, dataDir: dir, backupPath: null }, client);
    expect(writes.users).toHaveLength(0);
    expect(c.phoneNull).toBe(2); // 1 adult + 1 child
    expect(c.dobSentinel).toBe(1);
    expect(c.referralKeyword).toBeGreaterThanOrEqual(1);
  });

  it('apply creates everything with the signed mechanics', async () => {
    const dir = makeDataDir(FIXTURE_ADULTS, FIXTURE_CHILDREN);
    const { client, writes } = fakeDb();
    const c = await runImport({ apply: true, dataDir: dir, backupPath: backup() }, client);
    expect(c.failures).toHaveLength(0);
    expect(c.createdPatients).toBe(7);
    // AR-only name, no password, no english name.
    expect(writes.users.every((u) => u.passwordHash === null && u.fullNameEn === '')).toBe(true);
    // Deterministic ids.
    expect(writes.users.map((u) => u.id)).toEqual([
      'imp-a-001',
      'imp-a-002',
      'imp-a-003',
      'imp-c-001',
      'imp-c-002',
      'imp-c-003',
      'imp-c-004',
    ]);
    // Shared phone: two children carry the same number.
    expect(writes.users.filter((u) => u.phone === '+962790000300')).toHaveLength(2);
    // Sentinel DOB on the ageless adult.
    const sentinelProfile = writes.profiles.find(
      (p) => (p.dateOfBirth as Date).getUTCFullYear() === 1900,
    );
    expect(sentinelProfile?.userId).toBe('imp-a-002');
    // Intake provenance: COMPLETED, system actor, historical date.
    expect(
      writes.intakes.every((i) => i.status === 'COMPLETED' && i.assessedById === 'system'),
    ).toBe(true);
    expect((writes.intakes[0]!.assessedAt as Date).toISOString()).toContain('2024-03-01');
    // One audit row per patient, system actor.
    expect(writes.audits).toHaveLength(7);
    expect(writes.audits.every((a) => a.actorId === 'system')).toBe(true);
    // Enum mapping: keyword referral raw preserved to archive; sentinel note
    // present; out-of-options token stored VERBATIM in valueOptions.
    // One archive ANSWER per row that needed it (parts joined): imp-a-002
    // (sentinel + referral raw + truncated multi) and imp-a-003 (note +
    // unknown comorbidity).
    const archive = writes.answers.filter((a) => a.questionId === 'q-importArchiveNote');
    expect(archive).toHaveLength(2);
    const joined = archive.map((a) => String(a.value)).join('\n');
    expect(joined).toContain('تاريخ الميلاد غير معروف');
    expect(joined).toContain('كيف عرفت عن المركز (النص الأصلي)');
    expect(joined).toContain('مرض نادر جدا');
    expect(joined).toContain('راجع الرقم');
    const problems = writes.answers.find(
      (a) =>
        a.questionId === 'q-currentProblems' &&
        Array.isArray(a.valueOptions) &&
        (a.valueOptions as string[]).includes('Hypotonia'),
    );
    expect(problems).toBeDefined();
    // Mapped tokens became canonical opt-N values.
    expect((problems!.valueOptions as string[])[0]).toMatch(/^opt-\d+$/);
    // Child fixed fields coerced: "لا يوجد" → 0, "الثاني" → 2.
    expect(writes.pedData.map((p) => p.numberOfSiblings)).toContain(0);
    expect(writes.pedData.map((p) => p.birthOrder)).toContain(2);
  });

  it('idempotency: a second run creates zero', async () => {
    const dir = makeDataDir(FIXTURE_ADULTS, FIXTURE_CHILDREN);
    const all = [
      'imp-a-001',
      'imp-a-002',
      'imp-a-003',
      'imp-c-001',
      'imp-c-002',
      'imp-c-003',
      'imp-c-004',
    ];
    const { client, writes } = fakeDb(all);
    const c = await runImport({ apply: true, dataDir: dir, backupPath: backup() }, client);
    expect(c.createdPatients).toBe(0);
    expect(c.skippedExisting).toBe(7);
    expect(writes.users).toHaveLength(0);
  });

  it('apply refuses without a backup file', async () => {
    const dir = makeDataDir(FIXTURE_ADULTS, FIXTURE_CHILDREN);
    const { client } = fakeDb();
    await expect(
      runImport({ apply: true, dataDir: dir, backupPath: null }, client),
    ).rejects.toThrow(/backup/);
  });

  it('STOPs on an unmapped column instead of improvising', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'p52-bad-'));
    writeFileSync(
      join(dir, '3-patients-adults.csv'),
      REAL_ADULT_HEADER_ROW + ',عمود جديد غامض\r\n' + adultRow({}) + ',x\r\n',
    );
    writeFileSync(join(dir, '4-patients-children.csv'), REAL_CHILD_HEADER_ROW + '\r\n');
    const { client } = fakeDb();
    await expect(
      runImport({ apply: false, dataDir: dir, backupPath: null }, client),
    ).rejects.toThrow(/unmapped columns — STOP/);
  });

  it('side-effect suppression is structural: the importer never touches the queue or notifications', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/import-patients.ts'), 'utf8');
    expect(src).not.toContain('enqueueWhatsappOutbound');
    expect(src).not.toContain('createNotification');
    expect(src).not.toContain('sendPatientCredentials');
  });
});
