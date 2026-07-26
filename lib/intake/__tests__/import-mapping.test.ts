import { describe, expect, it } from 'vitest';

import {
  ADULT_COLUMN_MAP,
  CHILD_COLUMN_MAP,
  IMPORT_QUESTIONS,
  type ImportDestination,
} from '../import-mapping';

/**
 * Prompt 51 §5 — the mapping is the contract for the P52 importer: every
 * answer column of BOTH real files resolves to exactly one destination.
 * The fixtures below are the VERBATIM headers of the cleaned files.
 */

const ADULT_HEADERS = [
  'response_date',
  'full_name_ar',
  'age',
  'dob_approx',
  'gender',
  'phone_e164',
  'occupation',
  'address',
  'مستوى النشاط البدني',
  'التشخيص الطبي (تشخيص الطبيب الخاص بك)',
  'الشكوى الأساسية لديك \\من ماذا تعاني؟',
  'متى يزداد ألمك؟',
  'منذ متى تعاني من الأعراض التي لديك؟',
  'كم تصف شدة ألمك من 10؟ (10 هو أكبر ألم ممكن أن تشعر به, و0 هو عدم ا لشعور بالألم',
  'ما هي الأشياء والوضعيات التي تزيد الألم لديك؟',
  'ما هي الأشياء والوضعيات التي تفعلها لتخفيف الألم؟',
  'كيف تصف استقرار الألم لديك؟',
  'هل تتناول أي نوع من الأدوية بما يخص مشكلتك الحالية؟, اذكرها',
  'هل تتناول أي أدوية تخص حالة مرضية أخرى؟ اذكرها',
  'هل تعاني أو سبق أن عانيت من أي من الأمراض التالية؟',
  'هل تعاني من أي أمراض غير المذكورة في السؤال السابق؟ اذكرها',
  'هل سبق أن تعرضت لأي كسر؟ اذكر مكان الكسر',
  'هل سبق أن خضعت لعملية؟ اذكرها واذكر تاريخها',
  'هل سبق أن أخذت جلسات علاج طبيعي؟ (اذا كانت الاجابة نعم كيف تصف تجربتك؟)',
  'كيف عرفت عن المركز الأول للعلاج الطبيعي',
  'ملاحظة للمراجعة',
];

const CHILD_HEADERS = [
  'response_date',
  'child_name_ar',
  'gender',
  'dob',
  'phone_e164',
  'كم اخ للطفل',
  'ترتيب الطفل بين اخوته',
  'عمر الام وقت الحمل',
  'مدة الحمل بالاسبوع',
  'نوع الولادة',
  'هل عانيتي من أي صعوبات أو مشاكل خلال الولادة',
  'هل كانت الام تعاني من أي مرض أو أخذت أدوية أو تعرضت لأي نوع من الأشعة خلال فترة الحمل؟',
  'إذا كانت الاجابة نعم, الرجاء ذكر المرض,الدواء او الاشعة خلال فترة الحمل',
  'وزن الطفل',
  'بكاء الطفل مباشرة بعد ولادته',
  'هل عانى الطفل من أي مشاكل بعد الولادة',
  'هل دخل الطفل وحدة العناية المركزة لحديثي الولاده',
  'هل عرضتي طفلك على طبيب مختص بالأعصاب , أخصائي أطفال, أو أخصائي عظام و مفاصل, او غير ذلك؟',
  'هل يأخذ طفلك اي علاج او دواء؟',
  ':هل يعاني طفلك أي من المشاكل التالية',
  'هل خضع طفلك لأي عملية؟',
  'هل يعاني أحد اقارب الأم أو الأب من نفس المشكلة ؟',
  'هل يوجد صلة قرابة بين الوالدين',
  'هل أخذ طفلك جلسات علاجيه سابقا؟',
  'هل يعاني طفلك من مشاكل خوف زائده',
  'في اي مرحلة من التطور النمائي تجد طفلك؟',
  'ما هو الدواء الذي يأخذه ابنك بشكل مستمر؟',
  'نوع العملية',
  'ما سبب دخول إبنك وحدة العناية المركزة',
  'كيف عرفت عن المركز (موحّد)',
  'ملاحظة للمراجعة',
];

function checkComplete(headers: string[], map: Readonly<Record<string, ImportDestination>>) {
  for (const h of headers) {
    expect(map[h], `column has no destination: "${h}"`).toBeDefined();
  }
  // …and no stale mapped columns that don't exist in the file.
  for (const key of Object.keys(map)) {
    expect(headers.includes(key), `mapped column not in file: "${key}"`).toBe(true);
  }
}

describe('import mapping — every answer column has exactly one destination', () => {
  it('adults: all 26 columns covered, no orphans', () => {
    expect(ADULT_HEADERS).toHaveLength(26);
    checkComplete(ADULT_HEADERS, ADULT_COLUMN_MAP);
  });

  it('children: all 31 columns covered, no orphans', () => {
    expect(CHILD_HEADERS).toHaveLength(31);
    checkComplete(CHILD_HEADERS, CHILD_COLUMN_MAP);
  });

  it('every CUSTOM_QUESTION destination points at a defined question key', () => {
    const keys = new Set(IMPORT_QUESTIONS.map((q) => q.key));
    for (const dest of [...Object.values(ADULT_COLUMN_MAP), ...Object.values(CHILD_COLUMN_MAP)]) {
      if (dest.kind === 'CUSTOM_QUESTION') {
        expect(keys.has(dest.questionKey), `unknown question key ${dest.questionKey}`).toBe(true);
      }
    }
  });
});

describe('question catalog — the owner-signed set (23 active + 1 archive)', () => {
  it('23 active PEDIATRIC + 1 inactive BOTH archive — one per mapped sheet column', () => {
    expect(IMPORT_QUESTIONS).toHaveLength(24);
    const active = IMPORT_QUESTIONS.filter((q) => q.active);
    expect(active).toHaveLength(23);
    expect(active.every((q) => q.appliesTo === 'PEDIATRIC')).toBe(true);
    const archive = IMPORT_QUESTIONS.find((q) => !q.active)!;
    expect(archive).toMatchObject({
      key: 'importArchiveNote',
      appliesTo: 'BOTH',
      type: 'TEXTAREA',
    });
  });

  it('selects carry options; TEXT/NUMBER/TEXTAREA carry none', () => {
    for (const q of IMPORT_QUESTIONS) {
      if (q.type === 'SINGLE_SELECT' || q.type === 'MULTI_SELECT') {
        expect(q.options?.length, q.key).toBeGreaterThanOrEqual(2);
      } else {
        expect(q.options, q.key).toBeUndefined();
      }
    }
  });

  it('unique keys, unique nameAr (the idempotency key), unique displayOrder', () => {
    const keys = IMPORT_QUESTIONS.map((q) => q.key);
    const names = IMPORT_QUESTIONS.map((q) => q.nameAr);
    const orders = IMPORT_QUESTIONS.map((q) => q.displayOrder);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('owner-signed zero-loss types: birth weight + pregnancy illness are TEXT', () => {
    expect(IMPORT_QUESTIONS.find((q) => q.key === 'birthWeight')!.type).toBe('TEXT');
    expect(IMPORT_QUESTIONS.find((q) => q.key === 'pregnancyIllnessMedsRadiation')!.type).toBe(
      'TEXT',
    );
  });

  it('developmental stage carries the 8 milestones from the real data', () => {
    const q = IMPORT_QUESTIONS.find((x) => x.key === 'developmentalStage')!;
    expect(q.options).toHaveLength(8);
    expect(q.options!.map((o) => o.valueAr)).toContain('المشي بدون مساعدة');
  });
});
