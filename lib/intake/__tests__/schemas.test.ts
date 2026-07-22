import {
  Comorbidity,
  PainSeverity,
  PainStability,
  PainTiming,
  PhysicalActivityLevel,
  ReferralSource,
  SymptomDuration,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { adultIntakeSchema, pediatricIntakeSchema } from '../schemas';

function adultBase() {
  return {
    physicalActivityLevel: PhysicalActivityLevel.MODERATE,
    medicalDiagnosis: 'lumbar strain',
    primaryComplaint: 'lower back pain',
    painTiming: PainTiming.DAY,
    symptomDuration: SymptomDuration.WEEKS_2_3,
    painSeverity: PainSeverity.FIVE,
    painStability: PainStability.CONSTANT,
    conditions: [Comorbidity.NONE],
    referralSource: ReferralSource.FRIEND_FAMILY,
    customAnswers: {},
  };
}

describe('adultIntakeSchema', () => {
  it('accepts a minimal valid payload', () => {
    const r = adultIntakeSchema.safeParse(adultBase());
    expect(r.success).toBe(true);
  });

  it('accepts an EMPTY / omitted medicalDiagnosis — the label says «إن وجد» (NI-4, Prompt 38)', () => {
    expect(adultIntakeSchema.safeParse({ ...adultBase(), medicalDiagnosis: '' }).success).toBe(
      true,
    );
    const noField = { ...adultBase() } as Record<string, unknown>;
    delete noField.medicalDiagnosis;
    expect(adultIntakeSchema.safeParse(noField).success).toBe(true);
  });

  it('still rejects a missing truly-required field (primaryComplaint — regression)', () => {
    const r = adultIntakeSchema.safeParse({ ...adultBase(), primaryComplaint: '' });
    expect(r.success).toBe(false);
  });

  it('rejects NONE alongside another condition (mutual exclusion)', () => {
    const r = adultIntakeSchema.safeParse({
      ...adultBase(),
      conditions: [Comorbidity.NONE, Comorbidity.DIABETES],
    });
    expect(r.success).toBe(false);
  });

  it('requires otherConditions when OTHER is selected', () => {
    const r = adultIntakeSchema.safeParse({
      ...adultBase(),
      conditions: [Comorbidity.OTHER],
      otherConditions: null,
    });
    expect(r.success).toBe(false);
  });

  it('accepts OTHER + otherConditions text', () => {
    const r = adultIntakeSchema.safeParse({
      ...adultBase(),
      conditions: [Comorbidity.OTHER],
      otherConditions: 'fibromyalgia',
    });
    expect(r.success).toBe(true);
  });
});

describe('pediatricIntakeSchema', () => {
  it('accepts birthOrder <= siblings + 1', () => {
    expect(
      pediatricIntakeSchema.safeParse({ numberOfSiblings: 2, birthOrder: 3, customAnswers: {} })
        .success,
    ).toBe(true);
  });

  it('rejects birthOrder > siblings + 1', () => {
    const r = pediatricIntakeSchema.safeParse({
      numberOfSiblings: 1,
      birthOrder: 5,
      customAnswers: {},
    });
    expect(r.success).toBe(false);
  });

  it('coerces string numbers from form posts', () => {
    const r = pediatricIntakeSchema.safeParse({
      numberOfSiblings: '3',
      birthOrder: '2',
      customAnswers: {},
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.numberOfSiblings).toBe(3);
      expect(r.data.birthOrder).toBe(2);
    }
  });
});
