/**
 * Pediatric assessment — FIXED CORE (Prompt 21 §4).
 *
 * Single source of truth for the 65 core fields: drives the Zod schema
 * (`coreSchema.ts`), the form rendering, and the PDF export. The core is fixed
 * (guarantees longitudinal comparison later); custom fields are a separate,
 * editable model (`PediatricCustomField`).
 *
 * IMPORTANT (clinic decision): option strings are Dr. Sahar's exact wording and
 * MUST stay verbatim in English (e.g. "sublaxation", "Equines", "hip spika").
 * Do NOT "fix" spellings — they are the stored values. Field *labels* and
 * section headings are bilingual (Arabic default); the *values* stay English.
 */

export const CORE_SCHEMA_VERSION = 1;

export type CoreFieldType =
  | 'READONLY' // prefilled from the patient (child name, DOB/age) — not stored in coreData
  | 'DATE'
  | 'TEXT'
  | 'LONG_TEXT'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT'
  | 'SCORE_0_3';

export interface CoreField {
  key: string;
  section: string;
  labelEn: string;
  labelAr: string;
  type: CoreFieldType;
  /** Verbatim English option strings for SINGLE_SELECT / MULTI_SELECT. */
  options?: readonly string[];
  required?: boolean;
  /** Show + (optionally) require this field only when another field equals a value. */
  showWhen?: { key: string; equals: string };
  requiredWhenShown?: boolean;
}

export interface CoreSection {
  id: string;
  labelEn: string;
  labelAr: string;
}

export const CORE_SECTIONS: readonly CoreSection[] = [
  { id: 'history', labelEn: 'History', labelAr: 'التاريخ المرضي' },
  { id: 'tone', labelEn: 'Muscle tone', labelAr: 'التوتر العضلي' },
  { id: 'length', labelEn: 'Muscle length', labelAr: 'طول العضلات' },
  { id: 'reflexes', labelEn: 'Primitive reflexes', labelAr: 'المنعكسات البدائية' },
  { id: 'protective', labelEn: 'Protective reactions', labelAr: 'ردود الفعل الوقائية' },
  { id: 'function', labelEn: 'Function', labelAr: 'الوظيفة' },
  { id: 'milestones', labelEn: 'Milestones', labelAr: 'المراحل التطورية' },
  { id: 'posture', labelEn: 'Posture', labelAr: 'الوضعية' },
  { id: 'transitions', labelEn: 'Transitions (0–3)', labelAr: 'الانتقالات (0–3)' },
  { id: 'gait', labelEn: 'Gait & mobility', labelAr: 'المشية والحركة' },
  { id: 'development', labelEn: 'Development', labelAr: 'التطور' },
  { id: 'sensory', labelEn: 'Sensory', labelAr: 'الحسّي' },
] as const;

const TONE = ['Low', 'Normal', 'High'] as const;
const LENGTH = ['Normal', 'Tight', 'Severe restriction'] as const;
const REFLEX = ['Present', 'Integrated'] as const;
const YESNO_CAP = ['No', 'Yes'] as const; // "No/Yes" ordering per the form
const YESNO_LOWER = ['yes', 'No'] as const; // "yes/No" ordering per the form

export const CORE_FIELDS: readonly CoreField[] = [
  // ── Part A — History ──────────────────────────────────────────────────
  {
    key: 'childName',
    section: 'history',
    labelEn: 'Child Name',
    labelAr: 'اسم الطفل',
    type: 'READONLY',
  },
  {
    key: 'dobAge',
    section: 'history',
    labelEn: 'DOB / Age',
    labelAr: 'تاريخ الميلاد / العمر',
    type: 'READONLY',
  },
  { key: 'date', section: 'history', labelEn: 'Date', labelAr: 'التاريخ', type: 'DATE' },
  {
    key: 'botoxInjection',
    section: 'history',
    labelEn: 'Botox injection',
    labelAr: 'حقن البوتوكس',
    type: 'SINGLE_SELECT',
    options: YESNO_CAP,
  },
  {
    key: 'botoxDetails',
    section: 'history',
    labelEn: 'Botox details',
    labelAr: 'تفاصيل البوتوكس',
    type: 'TEXT',
    showWhen: { key: 'botoxInjection', equals: 'Yes' },
  },
  {
    key: 'referralSource',
    section: 'history',
    labelEn: 'Referral Source',
    labelAr: 'مصدر الإحالة',
    type: 'TEXT',
  },
  {
    key: 'primaryDiagnosis',
    section: 'history',
    labelEn: 'Primary Diagnosis',
    labelAr: 'التشخيص الأساسي',
    type: 'TEXT',
  },
  {
    key: 'gmfcsLevel',
    section: 'history',
    labelEn: 'GMFCS Level if known',
    labelAr: 'مستوى GMFCS إن وُجد',
    type: 'TEXT',
  },
  {
    key: 'pregnancyComplications',
    section: 'history',
    labelEn: 'Pregnancy complications',
    labelAr: 'مضاعفات الحمل',
    type: 'MULTI_SELECT',
    options: ['None', 'DM', 'HTN', 'Infection', 'Other'],
  },
  {
    key: 'delivery',
    section: 'history',
    labelEn: 'Delivery',
    labelAr: 'الولادة',
    type: 'SINGLE_SELECT',
    options: ['Normal', 'C-section', 'Assisted'],
  },
  {
    key: 'birthComplications',
    section: 'history',
    labelEn: 'Birth complications',
    labelAr: 'مضاعفات الولادة',
    type: 'MULTI_SELECT',
    options: ['Asphyxia', 'NICU', 'Cord around neck', 'Jaundice', 'None'],
  },
  {
    key: 'prematurity',
    section: 'history',
    labelEn: 'Prematurity',
    labelAr: 'الخداج',
    type: 'SINGLE_SELECT',
    options: YESNO_LOWER,
  },
  {
    key: 'prematurityWeeks',
    section: 'history',
    labelEn: 'Prematurity — weeks',
    labelAr: 'الخداج — الأسابيع',
    type: 'TEXT',
    showWhen: { key: 'prematurity', equals: 'yes' },
  },
  {
    key: 'nicu',
    section: 'history',
    labelEn: 'NICU',
    labelAr: 'العناية المركزة لحديثي الولادة',
    type: 'SINGLE_SELECT',
    options: YESNO_CAP,
  },
  {
    key: 'nicuDays',
    section: 'history',
    labelEn: 'NICU — days',
    labelAr: 'العناية المركزة — الأيام',
    type: 'TEXT',
    showWhen: { key: 'nicu', equals: 'Yes' },
    requiredWhenShown: true,
  },
  {
    key: 'mri',
    section: 'history',
    labelEn: 'MRI',
    labelAr: 'الرنين المغناطيسي',
    type: 'SINGLE_SELECT',
    options: ['Done', 'Not done'],
  },
  {
    key: 'geneticTesting',
    section: 'history',
    labelEn: 'Genetic testing',
    labelAr: 'الفحص الجيني',
    type: 'SINGLE_SELECT',
    options: ['Done', 'Not done'],
  },
  {
    key: 'seizures',
    section: 'history',
    labelEn: 'Seizures',
    labelAr: 'النوبات',
    type: 'SINGLE_SELECT',
    options: YESNO_CAP,
  },
  {
    key: 'medications',
    section: 'history',
    labelEn: 'Medications',
    labelAr: 'الأدوية',
    type: 'TEXT',
  },
  {
    key: 'historyObservations',
    section: 'history',
    labelEn: 'Any observations',
    labelAr: 'أي ملاحظات',
    type: 'LONG_TEXT',
    required: true,
  },

  // ── Part B — Clinical exam: muscle tone ───────────────────────────────
  {
    key: 'toneRUL',
    section: 'tone',
    labelEn: 'RUL',
    labelAr: 'الطرف العلوي الأيمن',
    type: 'SINGLE_SELECT',
    options: TONE,
  },
  {
    key: 'toneLUL',
    section: 'tone',
    labelEn: 'LUL',
    labelAr: 'الطرف العلوي الأيسر',
    type: 'SINGLE_SELECT',
    options: TONE,
  },
  {
    key: 'toneRLL',
    section: 'tone',
    labelEn: 'RLL',
    labelAr: 'الطرف السفلي الأيمن',
    type: 'SINGLE_SELECT',
    options: TONE,
  },
  {
    key: 'toneLLL',
    section: 'tone',
    labelEn: 'LLL',
    labelAr: 'الطرف السفلي الأيسر',
    type: 'SINGLE_SELECT',
    options: TONE,
  },

  // ── Muscle length ─────────────────────────────────────────────────────
  {
    key: 'lengthHamstrings',
    section: 'length',
    labelEn: 'Hamstrings',
    labelAr: 'أوتار الركبة',
    type: 'SINGLE_SELECT',
    options: LENGTH,
  },
  {
    key: 'lengthIliopsoas',
    section: 'length',
    labelEn: 'Iliopsoas',
    labelAr: 'العضلة الحرقفية القطنية',
    type: 'SINGLE_SELECT',
    options: LENGTH,
  },
  {
    key: 'lengthAdductors',
    section: 'length',
    labelEn: 'Adductors',
    labelAr: 'المقربات',
    type: 'SINGLE_SELECT',
    options: LENGTH,
  },
  {
    key: 'ankleDF',
    section: 'length',
    labelEn: 'Ankle DF',
    labelAr: 'عطف ظهري للكاحل',
    type: 'SINGLE_SELECT',
    options: ['Normal', 'Limited'],
  },

  // ── Primitive reflexes ────────────────────────────────────────────────
  {
    key: 'reflexATNR',
    section: 'reflexes',
    labelEn: 'ATNR',
    labelAr: 'ATNR',
    type: 'SINGLE_SELECT',
    options: REFLEX,
  },
  {
    key: 'reflexSTNR',
    section: 'reflexes',
    labelEn: 'STNR',
    labelAr: 'STNR',
    type: 'SINGLE_SELECT',
    options: REFLEX,
  },
  {
    key: 'reflexTLRSupine',
    section: 'reflexes',
    labelEn: 'TLR Supine',
    labelAr: 'TLR استلقاء',
    type: 'SINGLE_SELECT',
    options: REFLEX,
  },
  {
    key: 'reflexTLRProne',
    section: 'reflexes',
    labelEn: 'TLR Prone',
    labelAr: 'TLR انبطاح',
    type: 'SINGLE_SELECT',
    options: REFLEX,
  },

  // ── Protective ────────────────────────────────────────────────────────
  {
    key: 'parachute',
    section: 'protective',
    labelEn: 'Parachute',
    labelAr: 'منعكس المظلة',
    type: 'SINGLE_SELECT',
    options: ['present', 'absent'],
  },
  {
    key: 'landau',
    section: 'protective',
    labelEn: 'Landau',
    labelAr: 'منعكس لاندو',
    type: 'SINGLE_SELECT',
    options: ['present', 'Absent'],
  },

  // ── Function ──────────────────────────────────────────────────────────
  {
    key: 'pullToSit',
    section: 'function',
    labelEn: 'Pull to sit',
    labelAr: 'الشد للجلوس',
    type: 'SINGLE_SELECT',
    options: ['normal', 'weak L', 'weak R'],
  },
  {
    key: 'handFunction',
    section: 'function',
    labelEn: 'Hand Function',
    labelAr: 'وظيفة اليد',
    type: 'SINGLE_SELECT',
    options: ['above shoulder level', 'crossing midline', 'no HF'],
  },
  {
    key: 'hipSubluxation',
    section: 'function',
    labelEn: 'Hip sublaxation',
    labelAr: 'خلع الورك',
    type: 'SINGLE_SELECT',
    options: ['yes need hip spika and X Ray', 'normal'],
  },

  // ── Milestones ────────────────────────────────────────────────────────
  {
    key: 'rolling',
    section: 'milestones',
    labelEn: 'Rolling',
    labelAr: 'التقلّب',
    type: 'SINGLE_SELECT',
    options: ['None', 'Partial', 'Complete'],
  },
  {
    key: 'sitting',
    section: 'milestones',
    labelEn: 'Sitting',
    labelAr: 'الجلوس',
    type: 'SINGLE_SELECT',
    options: ['Unsupported', 'Supported', 'W-sitting pattern'],
  },
  {
    key: 'crawlingCreeping',
    section: 'milestones',
    labelEn: 'Crawling/Creeping',
    labelAr: 'الحبو/الزحف',
    type: 'SINGLE_SELECT',
    options: YESNO_LOWER,
  },
  {
    key: 'standing',
    section: 'milestones',
    labelEn: 'Standing',
    labelAr: 'الوقوف',
    type: 'SINGLE_SELECT',
    options: YESNO_LOWER,
  },
  {
    key: 'walking',
    section: 'milestones',
    labelEn: 'Walking',
    labelAr: 'المشي',
    type: 'SINGLE_SELECT',
    options: YESNO_LOWER,
  },

  // ── Posture ───────────────────────────────────────────────────────────
  {
    key: 'posture',
    section: 'posture',
    labelEn: 'Posture',
    labelAr: 'الوضعية',
    type: 'SINGLE_SELECT',
    options: ['Normal alignment', 'Kyphosis', 'Lordosis', 'Scoliosis (R/L)', 'Flat back'],
  },
  {
    key: 'hip',
    section: 'posture',
    labelEn: 'Hip',
    labelAr: 'الورك',
    type: 'SINGLE_SELECT',
    options: ['Anteversion', 'Retroversion', 'Normal'],
  },
  {
    key: 'knee',
    section: 'posture',
    labelEn: 'Knee',
    labelAr: 'الركبة',
    type: 'SINGLE_SELECT',
    options: ['Varus', 'Valgus', 'Neutral'],
  },
  {
    key: 'foot',
    section: 'posture',
    labelEn: 'Foot',
    labelAr: 'القدم',
    type: 'MULTI_SELECT',
    options: ['Flat', 'Cavus', 'Equines', 'Pronation', 'Supination'],
  },

  // ── Transitions (score 0–3) ───────────────────────────────────────────
  {
    key: 'transSitToStand',
    section: 'transitions',
    labelEn: 'Sit to stand',
    labelAr: 'من الجلوس للوقوف',
    type: 'SCORE_0_3',
  },
  {
    key: 'transSupineToSit',
    section: 'transitions',
    labelEn: 'Supine to sit',
    labelAr: 'من الاستلقاء للجلوس',
    type: 'SCORE_0_3',
  },
  {
    key: 'transSitToQuadruped',
    section: 'transitions',
    labelEn: 'Sit to quadruped',
    labelAr: 'من الجلوس للوضع الرباعي',
    type: 'SCORE_0_3',
  },
  {
    key: 'transKneeling',
    section: 'transitions',
    labelEn: 'Kneeling',
    labelAr: 'الجثو على الركبتين',
    type: 'SCORE_0_3',
  },
  {
    key: 'transHalfKneeling',
    section: 'transitions',
    labelEn: 'Half kneeling',
    labelAr: 'نصف جثو',
    type: 'SCORE_0_3',
  },
  {
    key: 'transStairClimbing',
    section: 'transitions',
    labelEn: 'Stair climbing',
    labelAr: 'صعود الدرج',
    type: 'SCORE_0_3',
  },

  // ── Gait & mobility ───────────────────────────────────────────────────
  {
    key: 'gaitPattern',
    section: 'gait',
    labelEn: 'Gait pattern',
    labelAr: 'نمط المشية',
    type: 'SINGLE_SELECT',
    options: ['Normal', 'Toe walking', 'Scissoring', 'Ataxic', 'Unable'],
  },
  {
    key: 'cruising',
    section: 'gait',
    labelEn: 'Cruising',
    labelAr: 'المشي بالاستناد',
    type: 'SINGLE_SELECT',
    options: ['Yes', 'No'],
  },
  {
    key: 'coreMuscles',
    section: 'gait',
    labelEn: 'Core muscles',
    labelAr: 'العضلات الأساسية',
    type: 'MULTI_SELECT',
    options: ['back weakness', 'abdominal weakness'],
  },
  {
    key: 'walker',
    section: 'gait',
    labelEn: 'Walker',
    labelAr: 'المشّاية',
    type: 'SINGLE_SELECT',
    options: YESNO_LOWER,
  },
  {
    key: 'orthotics',
    section: 'gait',
    labelEn: 'Orthotics',
    labelAr: 'الأجهزة التقويمية',
    type: 'SINGLE_SELECT',
    options: ['None', 'AFO', 'DAFO', 'SMO', 'KAFO'],
  },

  // ── Development ────────────────────────────────────────────────────────
  {
    key: 'eyeContact',
    section: 'development',
    labelEn: 'Eye contact',
    labelAr: 'التواصل البصري',
    type: 'SINGLE_SELECT',
    options: ['Good', 'Limited', 'Poor'],
  },
  {
    key: 'communication',
    section: 'development',
    labelEn: 'Communication',
    labelAr: 'التواصل',
    type: 'SINGLE_SELECT',
    options: ['Age appropriate', 'Delayed', 'Non-verbal'],
  },
  {
    key: 'cognition',
    section: 'development',
    labelEn: 'Cognition',
    labelAr: 'الإدراك',
    type: 'SINGLE_SELECT',
    options: ['Age appropriate', 'Delayed'],
  },

  // ── Sensory ───────────────────────────────────────────────────────────
  {
    key: 'sensoryIssue',
    section: 'sensory',
    labelEn: 'Sensory Issue',
    labelAr: 'مشكلة حسّية',
    type: 'SINGLE_SELECT',
    options: ['Normal', 'Hypersensitive', 'Hyposensitive'],
  },
  {
    key: 'vestibular',
    section: 'sensory',
    labelEn: 'Vestibular',
    labelAr: 'الدهليزي',
    type: 'SINGLE_SELECT',
    options: ['avoids movement', 'swings', 'balance activities'],
  },
  {
    key: 'tactile',
    section: 'sensory',
    labelEn: 'Tactile',
    labelAr: 'اللمسي',
    type: 'SINGLE_SELECT',
    options: ['avoids touch', 'messy play'],
  },
  {
    key: 'proprioceptive',
    section: 'sensory',
    labelEn: 'Proprioceptive',
    labelAr: 'الحس العميق',
    type: 'SINGLE_SELECT',
    options: ['overreacts to handling', 'poor tolerance to movement or positioning'],
  },
  {
    key: 'examObservations',
    section: 'sensory',
    labelEn: 'Any observations',
    labelAr: 'أي ملاحظات',
    type: 'LONG_TEXT',
    required: true,
  },
] as const;

/** Stored (user-input) core fields — excludes READONLY prefilled fields. */
export const STORED_CORE_FIELDS = CORE_FIELDS.filter((f) => f.type !== 'READONLY');

export function coreFieldsForSection(sectionId: string): readonly CoreField[] {
  return CORE_FIELDS.filter((f) => f.section === sectionId);
}
