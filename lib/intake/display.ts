import {
  Comorbidity,
  Gender,
  LanguagePref,
  PainSeverity,
  PainStability,
  PainTiming,
  PhysicalActivityLevel,
  ReferralSource,
  SymptomDuration,
} from '@prisma/client';

/**
 * Locale-aware DISPLAY helpers for intake answers (QA 13/7 item 5.1).
 *
 * Storage keeps the canonical English enum keys; every read surface maps a
 * stored value to the SAME localized option label the form inputs use
 * (`intake.adult` catalog keys in messages/{en,ar}.json). The key builders
 * here are the single source of truth shared by the form components
 * (`AdultIntakeFields`) and the read-only views (intake-submissions detail,
 * `IntakeAssessmentView`).
 *
 * Pure module — no JSX (lib rule), safe to import from client or server.
 */

/** Placeholder for an empty / missing answer. */
export const EMPTY_ANSWER_DISPLAY = '—';

/**
 * Minimal translator contract — satisfied by next-intl's `useTranslations` /
 * `getTranslations` bound to the `intake.adult` namespace, and trivially
 * mockable in tests.
 */
export type IntakeLabelTranslator = (key: string) => string;

/** SNAKE_CASE enum member → PascalCase i18n-key fragment (DOCTOR_REFERRAL → DoctorReferral). */
export function pascal(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

/** PainSeverity uses numeric key suffixes (severity0 … severity10) — exhaustive. */
export function severitySuffix(v: PainSeverity): string {
  switch (v) {
    case PainSeverity.ZERO:
      return '0';
    case PainSeverity.ONE_TWO:
      return '12';
    case PainSeverity.THREE_FOUR:
      return '34';
    case PainSeverity.FIVE:
      return '5';
    case PainSeverity.SIX_SEVEN:
      return '67';
    case PainSeverity.EIGHT_NINE:
      return '89';
    case PainSeverity.TEN:
      return '10';
  }
}

/** Enum → localized select options for the form inputs. */
export function enumOptions<E extends Record<string, string>>(
  e: E,
  label: (v: E[keyof E]) => string,
): Array<{ value: string; label: string }> {
  return (Object.values(e) as Array<E[keyof E]>).map((v) => ({
    value: v as string,
    label: label(v),
  }));
}

interface EnumFieldSpec {
  /** The Prisma enum object — membership gate before trusting the key builder. */
  members: Record<string, string>;
  /** Stored canonical value → key inside the `intake.adult` namespace. */
  key: (value: string) => string;
}

/**
 * Every fixed enum / multi-select field of the adult intake form, mapped to
 * its `intake.adult` label-key builder. The pediatric fixed fields
 * (numberOfSiblings, birthOrder) are numeric — no enums to map.
 */
const INTAKE_ENUM_FIELDS: Record<string, EnumFieldSpec> = {
  physicalActivityLevel: {
    members: PhysicalActivityLevel,
    key: (v) => `activity${pascal(v)}`,
  },
  painTiming: { members: PainTiming, key: (v) => `timing${pascal(v)}` },
  symptomDuration: { members: SymptomDuration, key: (v) => `duration${pascal(v)}` },
  painSeverity: {
    members: PainSeverity,
    key: (v) => `severity${severitySuffix(v as PainSeverity)}`,
  },
  painStability: { members: PainStability, key: (v) => `stability${pascal(v)}` },
  conditions: { members: Comorbidity, key: (v) => `condition${pascal(v)}` },
  referralSource: { members: ReferralSource, key: (v) => `referral${pascal(v)}` },
};

/**
 * `intake.adult` label key for a stored enum value, or null when the field is
 * not enum-typed or the value is not a known member (forward-compat: display
 * falls back to the raw value instead of throwing on a missing i18n key).
 */
export function intakeEnumLabelKey(field: string, value: string): string | null {
  const spec = INTAKE_ENUM_FIELDS[field];
  if (!spec) return null;
  if (!(Object.values(spec.members) as string[]).includes(value)) return null;
  return spec.key(value);
}

function formatSingleAnswer(field: string, value: unknown, t: IntakeLabelTranslator): string {
  const raw = String(value);
  const key = intakeEnumLabelKey(field, raw);
  return key ? t(key) : raw;
}

/**
 * Render one fixed intake answer for display: enum values go through the
 * localized option labels, arrays (conditions) are mapped element-wise and
 * comma-joined, free-text passes through, empty values render as a dash.
 */
export function formatIntakeAnswer(
  field: string,
  value: unknown,
  t: IntakeLabelTranslator,
): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY_ANSWER_DISPLAY;
    return value.map((v) => formatSingleAnswer(field, v, t)).join(', ');
  }
  if (value === null || value === undefined || value === '') return EMPTY_ANSWER_DISPLAY;
  return formatSingleAnswer(field, value, t);
}

/**
 * Key (inside the `publicIntake` namespace — same labels the public form
 * uses; `patients.form` carries identical twins for staff surfaces) for a
 * stored Gender value, or null for an unknown value.
 */
export function genderLabelKey(value: unknown): 'genderMale' | 'genderFemale' | null {
  if (value === Gender.MALE) return 'genderMale';
  if (value === Gender.FEMALE) return 'genderFemale';
  return null;
}

/**
 * Display label for a stored LanguagePref. Native language names are
 * locale-invariant proper nouns — the established precedent from
 * `PatientForm`'s language options — so no catalog lookup is needed.
 */
export function languagePrefLabel(value: unknown): string | null {
  if (value === LanguagePref.AR) return 'العربية';
  if (value === LanguagePref.EN) return 'English';
  return null;
}

/** Canonical custom-question option — matches `CustomQuestionOption` structurally. */
export interface IntakeCustomOption {
  value: string;
  valueEn: string;
  valueAr: string;
}

/**
 * Lenient parser for the `IntakeCustomQuestion.options` Json column —
 * mirrors the admin-side parser so read surfaces can resolve stored
 * canonical values without importing admin services.
 */
export function parseCustomOptions(raw: unknown): IntakeCustomOption[] {
  if (!Array.isArray(raw)) return [];
  const out: IntakeCustomOption[] = [];
  raw.forEach((o, i) => {
    if (!o || typeof o !== 'object') return;
    const rec = o as Record<string, unknown>;
    const valueEn = String(rec.valueEn ?? '');
    const valueAr = String(rec.valueAr ?? '');
    if (!valueEn || !valueAr) return;
    const value = typeof rec.value === 'string' && rec.value ? rec.value : `opt-${i}`;
    out.push({ value, valueEn, valueAr });
  });
  return out;
}

function resolveOneOption(
  options: readonly IntakeCustomOption[],
  stored: unknown,
  locale: 'en' | 'ar',
): string {
  const raw = String(stored);
  const match = options.find((o) => o.value === raw);
  if (!match) return raw; // renamed/deleted option or free-text answer — show the stored value
  return locale === 'ar' ? match.valueAr : match.valueEn;
}

/**
 * Render a stored custom-question answer: SINGLE/MULTI_SELECT answers store
 * the canonical option `value` and are resolved to the viewer-locale option
 * label (exactly what `CustomQuestionField` shows while filling the form);
 * anything without a matching option (TEXT/NUMBER/DATE answers, or a
 * deleted/renamed option) falls back to the stored raw value.
 */
export function resolveCustomAnswerValue(
  options: readonly IntakeCustomOption[],
  stored: unknown,
  locale: 'en' | 'ar',
): string {
  if (Array.isArray(stored)) {
    if (stored.length === 0) return EMPTY_ANSWER_DISPLAY;
    return stored.map((v) => resolveOneOption(options, v, locale)).join(', ');
  }
  if (stored === null || stored === undefined || stored === '') return EMPTY_ANSWER_DISPLAY;
  return resolveOneOption(options, stored, locale);
}
