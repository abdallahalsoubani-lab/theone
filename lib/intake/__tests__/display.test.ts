import {
  Comorbidity,
  Gender,
  PainSeverity,
  PainStability,
  PainTiming,
  PhysicalActivityLevel,
  ReferralSource,
  SymptomDuration,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

import {
  EMPTY_ANSWER_DISPLAY,
  formatIntakeAnswer,
  genderLabelKey,
  intakeEnumLabelKey,
  languagePrefLabel,
  parseCustomOptions,
  resolveCustomAnswerValue,
  severitySuffix,
} from '../display';

/**
 * QA 13/7 item 5.1 — stored canonical enum values must render through the
 * SAME localized option labels the form inputs use, in the viewer's locale,
 * with a raw-value fallback for unknown/custom values.
 */

const enAdult = en.intake.adult as Record<string, string>;
const arAdult = ar.intake.adult as Record<string, string>;
const tEn = (key: string) => enAdult[key] ?? key;
const tAr = (key: string) => arAdult[key] ?? key;

const ENUM_FIELDS: Array<[field: string, members: Record<string, string>]> = [
  ['physicalActivityLevel', PhysicalActivityLevel],
  ['painTiming', PainTiming],
  ['symptomDuration', SymptomDuration],
  ['painSeverity', PainSeverity],
  ['painStability', PainStability],
  ['conditions', Comorbidity],
  ['referralSource', ReferralSource],
];

describe('intakeEnumLabelKey', () => {
  it.each(ENUM_FIELDS)(
    '%s: every enum member maps to a key that exists in BOTH catalogs',
    (field, members) => {
      for (const value of Object.values(members)) {
        const key = intakeEnumLabelKey(field, value);
        expect(key, `${field}.${value} should map to a label key`).toBeTruthy();
        expect(enAdult[key as string], `en intake.adult.${key}`).toBeTruthy();
        expect(arAdult[key as string], `ar intake.adult.${key}`).toBeTruthy();
      }
    },
  );

  it('returns null for a non-enum field and for an unknown member', () => {
    expect(intakeEnumLabelKey('medicalDiagnosis', 'anything')).toBeNull();
    expect(intakeEnumLabelKey('painStability', 'NOT_A_MEMBER')).toBeNull();
  });

  it('severitySuffix stays exhaustive over PainSeverity', () => {
    for (const v of Object.values(PainSeverity)) {
      expect(enAdult[`severity${severitySuffix(v)}`]).toBeTruthy();
    }
  });
});

describe('formatIntakeAnswer', () => {
  it('maps a known enum value to the EN label under en and the AR label under ar', () => {
    expect(formatIntakeAnswer('painStability', PainStability.CONSTANT, tEn)).toBe(
      enAdult.stabilityConstant,
    );
    expect(formatIntakeAnswer('painStability', PainStability.CONSTANT, tAr)).toBe(
      arAdult.stabilityConstant,
    );
    expect(formatIntakeAnswer('painSeverity', PainSeverity.SIX_SEVEN, tAr)).toBe(
      arAdult.severity67,
    );
  });

  it('passes unknown enum members and free-text values through raw', () => {
    expect(formatIntakeAnswer('painStability', 'BRAND_NEW_VALUE', tEn)).toBe('BRAND_NEW_VALUE');
    expect(formatIntakeAnswer('medicalDiagnosis', 'lower back pain', tEn)).toBe('lower back pain');
  });

  it('formats the conditions array as comma-joined localized labels', () => {
    const value = [Comorbidity.DIABETES, Comorbidity.HYPERTENSION];
    expect(formatIntakeAnswer('conditions', value, tEn)).toBe(
      `${enAdult.conditionDiabetes}, ${enAdult.conditionHypertension}`,
    );
    expect(formatIntakeAnswer('conditions', value, tAr)).toBe(
      `${arAdult.conditionDiabetes}, ${arAdult.conditionHypertension}`,
    );
  });

  it('renders empty values as a dash', () => {
    expect(formatIntakeAnswer('conditions', [], tEn)).toBe(EMPTY_ANSWER_DISPLAY);
    expect(formatIntakeAnswer('otherMedications', null, tEn)).toBe(EMPTY_ANSWER_DISPLAY);
    expect(formatIntakeAnswer('otherMedications', '', tEn)).toBe(EMPTY_ANSWER_DISPLAY);
    expect(formatIntakeAnswer('otherMedications', undefined, tEn)).toBe(EMPTY_ANSWER_DISPLAY);
  });
});

describe('gender + language labels', () => {
  it('maps Gender to the publicIntake label keys present in both catalogs', () => {
    const enPublic = en.publicIntake as Record<string, string>;
    const arPublic = ar.publicIntake as Record<string, string>;
    for (const g of Object.values(Gender)) {
      const key = genderLabelKey(g);
      expect(key).toBeTruthy();
      expect(enPublic[key as string]).toBeTruthy();
      expect(arPublic[key as string]).toBeTruthy();
    }
    expect(genderLabelKey('UNKNOWN')).toBeNull();
    expect(genderLabelKey(null)).toBeNull();
  });

  it('maps LanguagePref to the native language names', () => {
    expect(languagePrefLabel('AR')).toBe('العربية');
    expect(languagePrefLabel('EN')).toBe('English');
    expect(languagePrefLabel('FR')).toBeNull();
    expect(languagePrefLabel(undefined)).toBeNull();
  });
});

describe('resolveCustomAnswerValue', () => {
  const options = [
    { value: 'opt-0', valueEn: 'Morning', valueAr: 'صباحاً' },
    { value: 'opt-1', valueEn: 'Evening', valueAr: 'مساءً' },
  ];

  it('resolves a stored canonical value to the viewer-locale label', () => {
    expect(resolveCustomAnswerValue(options, 'opt-0', 'en')).toBe('Morning');
    expect(resolveCustomAnswerValue(options, 'opt-0', 'ar')).toBe('صباحاً');
  });

  it('joins multi-select answers with localized labels', () => {
    expect(resolveCustomAnswerValue(options, ['opt-0', 'opt-1'], 'ar')).toBe('صباحاً, مساءً');
  });

  it('falls back to the raw value for unmatched/free-text answers', () => {
    expect(resolveCustomAnswerValue(options, 'opt-deleted', 'en')).toBe('opt-deleted');
    expect(resolveCustomAnswerValue([], 'free text answer', 'ar')).toBe('free text answer');
    expect(resolveCustomAnswerValue(options, ['opt-0', 'gone'], 'en')).toBe('Morning, gone');
  });

  it('renders empty answers as a dash', () => {
    expect(resolveCustomAnswerValue(options, '', 'en')).toBe(EMPTY_ANSWER_DISPLAY);
    expect(resolveCustomAnswerValue(options, [], 'en')).toBe(EMPTY_ANSWER_DISPLAY);
    expect(resolveCustomAnswerValue(options, null, 'en')).toBe(EMPTY_ANSWER_DISPLAY);
  });
});

describe('parseCustomOptions', () => {
  it('parses the Json options column leniently and skips malformed entries', () => {
    const parsed = parseCustomOptions([
      { value: 'opt-0', valueEn: 'Yes', valueAr: 'نعم' },
      { valueEn: 'No', valueAr: 'لا' }, // missing canonical value → positional fallback
      { valueEn: 'broken' }, // missing valueAr → dropped
      'not-an-object',
      null,
    ]);
    expect(parsed).toEqual([
      { value: 'opt-0', valueEn: 'Yes', valueAr: 'نعم' },
      { value: 'opt-1', valueEn: 'No', valueAr: 'لا' },
    ]);
    expect(parseCustomOptions(null)).toEqual([]);
    expect(parseCustomOptions('junk')).toEqual([]);
  });
});
