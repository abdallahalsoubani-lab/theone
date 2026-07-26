import type { CustomQuestionAppliesTo, CustomQuestionType } from '@prisma/client';

/**
 * Prompt 51 — the single source of truth mapping the clinic's REAL intake
 * sheets (the cleaned Google-Forms exports in ~/import-data) onto system
 * storage. Owner-signed direction: the sheets win; adult columns map 1:1
 * onto the fixed AdultIntakeData fields (the system was built from the same
 * form), children get 19 new active custom questions + 1 shared archive
 * question.
 *
 * Consumed by:
 *   - scripts/seed-intake-questions.ts  (creates the custom questions)
 *   - the Prompt 52 importer            (column → destination, zero
 *                                        modeling decisions left there)
 *
 * Question identity: `key` is the stable identifier — the seed upserts by
 * nameAr, and the importer resolves key → question id at runtime. Labels
 * are VERBATIM sheet headers (owner ruling), lightly trimmed only.
 */

// ─── The new custom questions (19 active PEDIATRIC + 1 archive BOTH) ───────

export interface ImportQuestionDef {
  key: string;
  nameAr: string;
  nameEn: string;
  type: CustomQuestionType;
  /** [{valueEn, valueAr}] — only for selects. */
  options?: Array<{ valueEn: string; valueAr: string }>;
  appliesTo: CustomQuestionAppliesTo;
  /** Archive questions hold imported answers but never render on new forms. */
  active: boolean;
  /** Sheet-flow order (owner ruling: no sections, sheet sequence). */
  displayOrder: number;
}

const YES_NO = [
  { valueEn: 'Yes', valueAr: 'نعم' },
  { valueEn: 'No', valueAr: 'لا' },
];

export const IMPORT_QUESTIONS: readonly ImportQuestionDef[] = [
  {
    key: 'motherAgeAtPregnancy',
    nameAr: 'عمر الام وقت الحمل',
    nameEn: "Mother's age at pregnancy",
    type: 'NUMBER',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 10,
  },
  {
    key: 'pregnancyDurationWeeks',
    nameAr: 'مدة الحمل بالاسبوع',
    nameEn: 'Pregnancy duration (weeks)',
    type: 'NUMBER',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 20,
  },
  {
    key: 'deliveryType',
    nameAr: 'نوع الولادة',
    nameEn: 'Delivery type',
    type: 'SINGLE_SELECT',
    options: [
      { valueEn: 'Natural', valueAr: 'طبيعية' },
      { valueEn: 'Cesarean', valueAr: 'قيصرية' },
    ],
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 30,
  },
  {
    key: 'deliveryComplications',
    nameAr: 'هل عانيتي من أي صعوبات أو مشاكل خلال الولادة',
    nameEn: 'Difficulties or problems during delivery',
    type: 'MULTI_SELECT',
    options: [
      { valueEn: 'Difficult labor', valueAr: 'عسر ولادة' },
      { valueEn: 'Bleeding', valueAr: 'نزيف' },
      { valueEn: 'Baby malposition', valueAr: 'وضعية الطفل خاطئة' },
      { valueEn: 'Cord wrapped around the baby', valueAr: 'التفاف الحبل السري حول الطفل' },
      { valueEn: 'Forceps use', valueAr: 'استخدام الملقط' },
      { valueEn: 'Other', valueAr: 'أخرى' },
    ],
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 40,
  },
  {
    key: 'pregnancyIllnessMedsRadiation',
    nameAr:
      'هل كانت الام تعاني من أي مرض أو أخذت أدوية أو تعرضت لأي نوع من الأشعة خلال فترة الحمل؟',
    nameEn: 'Illness, medication, or radiation exposure during pregnancy',
    // Owner-signed: TEXT (historical answers mix yes/no with details).
    type: 'TEXT',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 50,
  },
  {
    key: 'pregnancyIllnessDetails',
    nameAr: 'الرجاء ذكر المرض او الدواء او الاشعة خلال فترة الحمل',
    nameEn: 'Details of the illness, medication, or radiation during pregnancy',
    type: 'TEXTAREA',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 60,
  },
  {
    key: 'birthWeight',
    nameAr: 'وزن الطفل',
    nameEn: "Child's weight",
    // Owner-signed: TEXT (historical data mixes units — zero-loss).
    type: 'TEXT',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 70,
  },
  {
    key: 'criedImmediately',
    nameAr: 'بكاء الطفل مباشرة بعد ولادته',
    nameEn: 'Did the baby cry immediately after birth',
    type: 'SINGLE_SELECT',
    options: [
      { valueEn: 'Yes', valueAr: 'نعم' },
      { valueEn: 'No', valueAr: 'لا' },
      { valueEn: 'Took time', valueAr: 'اخذ وقت' },
    ],
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 80,
  },
  {
    key: 'postBirthProblems',
    nameAr: 'هل عانى الطفل من أي مشاكل بعد الولادة',
    nameEn: 'Any problems after birth',
    type: 'SINGLE_SELECT',
    options: YES_NO,
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 90,
  },
  {
    key: 'nicuAdmission',
    nameAr: 'هل دخل الطفل وحدة العناية المركزة لحديثي الولاده',
    nameEn: 'NICU admission',
    type: 'SINGLE_SELECT',
    options: YES_NO,
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 100,
  },
  {
    key: 'specialistConsult',
    nameAr:
      'هل عرضتي طفلك على طبيب مختص بالأعصاب او أخصائي أطفال او أخصائي عظام و مفاصل او غير ذلك؟',
    nameEn: 'Was the child seen by a specialist (neurology, pediatrics, orthopedics, …)',
    type: 'SINGLE_SELECT',
    options: YES_NO,
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 110,
  },
  {
    key: 'takesMedication',
    nameAr: 'هل يأخذ طفلك اي علاج او دواء؟',
    nameEn: 'Does the child take any treatment or medication',
    type: 'SINGLE_SELECT',
    options: YES_NO,
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 120,
  },
  {
    key: 'currentProblems',
    nameAr: 'هل يعاني طفلك أي من المشاكل التالية',
    nameEn: 'Does the child have any of the following problems',
    type: 'MULTI_SELECT',
    options: [
      { valueEn: 'Motor', valueAr: 'حركية' },
      { valueEn: 'Speech', valueAr: 'نطق' },
      { valueEn: 'Visual', valueAr: 'بصرية' },
      { valueEn: 'Hearing', valueAr: 'سمعية' },
      { valueEn: 'Cognitive', valueAr: 'مشاكل عقلية' },
      { valueEn: 'None', valueAr: 'لا يوجد' },
    ],
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 130,
  },
  {
    key: 'hadSurgery',
    nameAr: 'هل خضع طفلك لأي عملية؟',
    nameEn: 'Has the child had any surgery',
    type: 'SINGLE_SELECT',
    options: YES_NO,
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 140,
  },
  {
    key: 'relativeSameProblem',
    nameAr: 'هل يعاني أحد اقارب الأم أو الأب من نفس المشكلة؟',
    nameEn: 'Does a relative of the mother or father have the same problem',
    type: 'SINGLE_SELECT',
    options: YES_NO,
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 150,
  },
  {
    key: 'parentsRelated',
    nameAr: 'هل يوجد صلة قرابة بين الوالدين',
    nameEn: 'Are the parents related',
    type: 'SINGLE_SELECT',
    options: YES_NO,
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 160,
  },
  {
    key: 'previousTherapy',
    nameAr: 'هل أخذ طفلك جلسات علاجيه سابقا؟',
    nameEn: 'Previous therapy sessions',
    type: 'MULTI_SELECT',
    options: [
      { valueEn: 'Physical therapy', valueAr: 'علاج طبيعي' },
      { valueEn: 'Occupational therapy', valueAr: 'علاج وظيفي' },
      { valueEn: 'Speech & swallowing therapy', valueAr: 'علاج نطق وبلع' },
      { valueEn: 'None', valueAr: 'لم يأخذ' },
    ],
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 170,
  },
  {
    key: 'excessiveFear',
    nameAr: 'هل يعاني طفلك من مشاكل خوف زائده',
    nameEn: 'Excessive fear problems',
    type: 'SINGLE_SELECT',
    options: YES_NO,
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 180,
  },
  {
    key: 'developmentalStage',
    nameAr: 'في اي مرحلة من التطور النمائي تجد طفلك؟',
    nameEn: 'Current developmental stage of the child',
    type: 'MULTI_SELECT',
    options: [
      { valueEn: 'Head control', valueAr: 'التحكم بالرأس' },
      { valueEn: 'Rolls back to tummy', valueAr: 'يستطيع الدوران من ظهره الى بطنه' },
      { valueEn: 'Rolls tummy to back', valueAr: 'يستطيع الدوران من بطنه لظهره' },
      { valueEn: 'Crawls on tummy', valueAr: 'يزحف على بطنه' },
      { valueEn: 'Crawls on hands and knees', valueAr: 'الزحف على اليدين و الركب' },
      { valueEn: 'Sits without support', valueAr: 'الجلوس بدون مساعده' },
      { valueEn: 'Stands without support', valueAr: 'الوقوف بدون مساعدة' },
      { valueEn: 'Walks without support', valueAr: 'المشي بدون مساعدة' },
    ],
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 190,
  },
  {
    key: 'continuousMedication',
    nameAr: 'ما هو الدواء الذي يأخذه ابنك بشكل مستمر؟',
    nameEn: 'Medication the child takes continuously',
    type: 'TEXT',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 200,
  },
  {
    key: 'surgeryType',
    nameAr: 'نوع العملية',
    nameEn: 'Type of surgery',
    type: 'TEXT',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 210,
  },
  {
    key: 'nicuReason',
    nameAr: 'ما سبب دخول إبنك وحدة العناية المركزة',
    nameEn: 'Reason for NICU admission',
    type: 'TEXT',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 220,
  },
  {
    key: 'referralSourceChild',
    nameAr: 'كيف عرفت عن المركز الأول للعلاج الطبيعي',
    nameEn: 'How did you hear about The One Physical Therapy Center',
    type: 'TEXT',
    appliesTo: 'PEDIATRIC',
    active: true,
    displayOrder: 230,
  },
  {
    // ARCHIVE (owner-signed): holds import review-notes + transform
    // leftovers. Never renders on new forms; imported answers still display
    // in the patient file (the view reads stored answers, not active
    // questions).
    key: 'importArchiveNote',
    nameAr: 'ملاحظات الاستيراد (أرشيف)',
    nameEn: 'Import notes (archive)',
    type: 'TEXTAREA',
    appliesTo: 'BOTH',
    active: false,
    displayOrder: 900,
  },
] as const;

// ─── Column → destination map ──────────────────────────────────────────────

export type ImportDestination =
  | { kind: 'IDENTITY'; field: 'responseDate' | 'nameAr' | 'age' | 'dob' | 'gender' | 'phone' }
  | { kind: 'PROFILE_FIELD'; field: 'occupation' | 'address' }
  | {
      kind: 'EXISTING_FIELD';
      model: 'AdultIntakeData' | 'PediatricIntakeData';
      field: string;
      /** Import-time transform id — implemented by the P52 importer. */
      transform?:
        | 'ENUM_PHYSICAL_ACTIVITY'
        | 'ENUM_PAIN_TIMING'
        | 'ENUM_SYMPTOM_DURATION'
        | 'ENUM_PAIN_SEVERITY'
        | 'ENUM_PAIN_STABILITY'
        | 'ENUM_COMORBIDITIES'
        | 'ENUM_REFERRAL_KEYWORDS'
        | 'PARSE_INT_ARABIC'
        | 'DEFAULT_IF_EMPTY';
    }
  | { kind: 'CUSTOM_QUESTION'; questionKey: string }
  | { kind: 'ARCHIVE_NOTE' };

/** Keyed by the VERBATIM sheet header. */
export const ADULT_COLUMN_MAP: Readonly<Record<string, ImportDestination>> = {
  response_date: { kind: 'IDENTITY', field: 'responseDate' },
  full_name_ar: { kind: 'IDENTITY', field: 'nameAr' },
  age: { kind: 'IDENTITY', field: 'age' },
  dob_approx: { kind: 'IDENTITY', field: 'dob' },
  gender: { kind: 'IDENTITY', field: 'gender' },
  phone_e164: { kind: 'IDENTITY', field: 'phone' },
  occupation: { kind: 'PROFILE_FIELD', field: 'occupation' },
  address: { kind: 'PROFILE_FIELD', field: 'address' },
  'مستوى النشاط البدني': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'physicalActivityLevel',
    transform: 'ENUM_PHYSICAL_ACTIVITY',
  },
  'التشخيص الطبي (تشخيص الطبيب الخاص بك)': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'medicalDiagnosis',
  },
  'الشكوى الأساسية لديك \\من ماذا تعاني؟': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'primaryComplaint',
    transform: 'DEFAULT_IF_EMPTY',
  },
  'متى يزداد ألمك؟': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'painTiming',
    transform: 'ENUM_PAIN_TIMING',
  },
  'منذ متى تعاني من الأعراض التي لديك؟': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'symptomDuration',
    transform: 'ENUM_SYMPTOM_DURATION',
  },
  'كم تصف شدة ألمك من 10؟ (10 هو أكبر ألم ممكن أن تشعر به, و0 هو عدم ا لشعور بالألم': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'painSeverity',
    transform: 'ENUM_PAIN_SEVERITY',
  },
  'ما هي الأشياء والوضعيات التي تزيد الألم لديك؟': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'painAggravatingFactors',
  },
  'ما هي الأشياء والوضعيات التي تفعلها لتخفيف الألم؟': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'painRelievingFactors',
  },
  'كيف تصف استقرار الألم لديك؟': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'painStability',
    transform: 'ENUM_PAIN_STABILITY',
  },
  'هل تتناول أي نوع من الأدوية بما يخص مشكلتك الحالية؟, اذكرها': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'currentMedicationsForProblem',
  },
  'هل تتناول أي أدوية تخص حالة مرضية أخرى؟ اذكرها': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'otherMedications',
  },
  'هل تعاني أو سبق أن عانيت من أي من الأمراض التالية؟': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'conditions',
    transform: 'ENUM_COMORBIDITIES',
  },
  'هل تعاني من أي أمراض غير المذكورة في السؤال السابق؟ اذكرها': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'otherConditions',
  },
  'هل سبق أن تعرضت لأي كسر؟ اذكر مكان الكسر': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'previousFractures',
  },
  'هل سبق أن خضعت لعملية؟ اذكرها واذكر تاريخها': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'previousSurgeries',
  },
  'هل سبق أن أخذت جلسات علاج طبيعي؟ (اذا كانت الاجابة نعم كيف تصف تجربتك؟)': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'previousPtExperience',
  },
  // Owner-signed: keyword-mapped into the fixed enum; raw preserved in the
  // archive note when it does not map exactly.
  'كيف عرفت عن المركز الأول للعلاج الطبيعي': {
    kind: 'EXISTING_FIELD',
    model: 'AdultIntakeData',
    field: 'referralSource',
    transform: 'ENUM_REFERRAL_KEYWORDS',
  },
  'ملاحظة للمراجعة': { kind: 'ARCHIVE_NOTE' },
};

export const CHILD_COLUMN_MAP: Readonly<Record<string, ImportDestination>> = {
  response_date: { kind: 'IDENTITY', field: 'responseDate' },
  child_name_ar: { kind: 'IDENTITY', field: 'nameAr' },
  gender: { kind: 'IDENTITY', field: 'gender' },
  dob: { kind: 'IDENTITY', field: 'dob' },
  phone_e164: { kind: 'IDENTITY', field: 'phone' },
  'كم اخ للطفل': {
    kind: 'EXISTING_FIELD',
    model: 'PediatricIntakeData',
    field: 'numberOfSiblings',
    transform: 'PARSE_INT_ARABIC',
  },
  'ترتيب الطفل بين اخوته': {
    kind: 'EXISTING_FIELD',
    model: 'PediatricIntakeData',
    field: 'birthOrder',
    transform: 'PARSE_INT_ARABIC',
  },
  'عمر الام وقت الحمل': { kind: 'CUSTOM_QUESTION', questionKey: 'motherAgeAtPregnancy' },
  'مدة الحمل بالاسبوع': { kind: 'CUSTOM_QUESTION', questionKey: 'pregnancyDurationWeeks' },
  'نوع الولادة': { kind: 'CUSTOM_QUESTION', questionKey: 'deliveryType' },
  'هل عانيتي من أي صعوبات أو مشاكل خلال الولادة': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'deliveryComplications',
  },
  'هل كانت الام تعاني من أي مرض أو أخذت أدوية أو تعرضت لأي نوع من الأشعة خلال فترة الحمل؟': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'pregnancyIllnessMedsRadiation',
  },
  'إذا كانت الاجابة نعم, الرجاء ذكر المرض,الدواء او الاشعة خلال فترة الحمل': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'pregnancyIllnessDetails',
  },
  'وزن الطفل': { kind: 'CUSTOM_QUESTION', questionKey: 'birthWeight' },
  'بكاء الطفل مباشرة بعد ولادته': { kind: 'CUSTOM_QUESTION', questionKey: 'criedImmediately' },
  'هل عانى الطفل من أي مشاكل بعد الولادة': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'postBirthProblems',
  },
  'هل دخل الطفل وحدة العناية المركزة لحديثي الولاده': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'nicuAdmission',
  },
  'هل عرضتي طفلك على طبيب مختص بالأعصاب , أخصائي أطفال, أو أخصائي عظام و مفاصل, او غير ذلك؟': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'specialistConsult',
  },
  'هل يأخذ طفلك اي علاج او دواء؟': { kind: 'CUSTOM_QUESTION', questionKey: 'takesMedication' },
  ':هل يعاني طفلك أي من المشاكل التالية': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'currentProblems',
  },
  'هل خضع طفلك لأي عملية؟': { kind: 'CUSTOM_QUESTION', questionKey: 'hadSurgery' },
  'هل يعاني أحد اقارب الأم أو الأب من نفس المشكلة ؟': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'relativeSameProblem',
  },
  'هل يوجد صلة قرابة بين الوالدين': { kind: 'CUSTOM_QUESTION', questionKey: 'parentsRelated' },
  'هل أخذ طفلك جلسات علاجيه سابقا؟': { kind: 'CUSTOM_QUESTION', questionKey: 'previousTherapy' },
  'هل يعاني طفلك من مشاكل خوف زائده': { kind: 'CUSTOM_QUESTION', questionKey: 'excessiveFear' },
  'في اي مرحلة من التطور النمائي تجد طفلك؟': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'developmentalStage',
  },
  'ما هو الدواء الذي يأخذه ابنك بشكل مستمر؟': {
    kind: 'CUSTOM_QUESTION',
    questionKey: 'continuousMedication',
  },
  'نوع العملية': { kind: 'CUSTOM_QUESTION', questionKey: 'surgeryType' },
  'ما سبب دخول إبنك وحدة العناية المركزة': { kind: 'CUSTOM_QUESTION', questionKey: 'nicuReason' },
  'كيف عرفت عن المركز (موحّد)': { kind: 'CUSTOM_QUESTION', questionKey: 'referralSourceChild' },
  'ملاحظة للمراجعة': { kind: 'ARCHIVE_NOTE' },
};
