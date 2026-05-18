/**
 * Exercise taxonomy (Prompt 10 §4.4).
 *
 * Categories + anatomical regions are stored as plain strings on the
 * Exercise rows; this file is the canonical source of allowed values.
 * Admins extend either list by editing the constants — there is no CMS
 * for taxonomy in v1.
 *
 * Adding a value: append to the array, add the labelAr translation,
 * the form's <select> picks it up automatically.
 */

export interface TaxonomyOption {
  value: string;
  labelEn: string;
  labelAr: string;
}

export const EXERCISE_CATEGORIES: ReadonlyArray<TaxonomyOption> = [
  { value: 'STRETCHING', labelEn: 'Stretching', labelAr: 'إطالة' },
  { value: 'STRENGTH', labelEn: 'Strength', labelAr: 'تقوية' },
  { value: 'MOBILITY', labelEn: 'Mobility', labelAr: 'مرونة' },
  { value: 'BALANCE', labelEn: 'Balance', labelAr: 'توازن' },
  { value: 'CARDIO', labelEn: 'Cardio', labelAr: 'تحمل قلبي' },
  { value: 'NEUROMOTOR', labelEn: 'Neuromotor', labelAr: 'حركي عصبي' },
];

export const ANATOMICAL_REGIONS: ReadonlyArray<TaxonomyOption> = [
  { value: 'SHOULDER', labelEn: 'Shoulder', labelAr: 'الكتف' },
  { value: 'CERVICAL', labelEn: 'Cervical', labelAr: 'الرقبة' },
  { value: 'LOWER_BACK', labelEn: 'Lower back', labelAr: 'أسفل الظهر' },
  { value: 'HIP', labelEn: 'Hip', labelAr: 'الورك' },
  { value: 'KNEE', labelEn: 'Knee', labelAr: 'الركبة' },
  { value: 'ANKLE', labelEn: 'Ankle', labelAr: 'الكاحل' },
  { value: 'WRIST', labelEn: 'Wrist', labelAr: 'الرسغ' },
  { value: 'CORE', labelEn: 'Core', labelAr: 'البطن والظهر' },
  { value: 'FULL_BODY', labelEn: 'Full body', labelAr: 'كامل الجسم' },
];

const CATEGORY_VALUES = new Set(EXERCISE_CATEGORIES.map((c) => c.value));
const REGION_VALUES = new Set(ANATOMICAL_REGIONS.map((r) => r.value));

export function isValidCategory(value: string): boolean {
  return CATEGORY_VALUES.has(value);
}
export function isValidRegion(value: string): boolean {
  return REGION_VALUES.has(value);
}

export function labelForCategory(value: string, locale: 'en' | 'ar'): string {
  const found = EXERCISE_CATEGORIES.find((c) => c.value === value);
  if (!found) return value;
  return locale === 'ar' ? found.labelAr : found.labelEn;
}
export function labelForRegion(value: string, locale: 'en' | 'ar'): string {
  const found = ANATOMICAL_REGIONS.find((r) => r.value === value);
  if (!found) return value;
  return locale === 'ar' ? found.labelAr : found.labelEn;
}
