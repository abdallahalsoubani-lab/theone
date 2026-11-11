import {
  Comorbidity,
  IntakeType,
  PainSeverity,
  PainStability,
  PainTiming,
  PhysicalActivityLevel,
  ReferralSource,
  SymptomDuration,
} from '@prisma/client';
import { z } from 'zod';

/**
 * Adult intake — single big Zod schema mirroring the Google-Form fields in
 * Prompt 6 §4.4. P64 #8: every fixed field is OPTIONAL now — new intakes ask
 * only the admin-managed custom questions (which had duplicated these); the
 * fields stay so historical payloads and pending submissions still parse. The Section F "NONE" + "OTHER" mutual-exclusion rule and
 * the "OTHER -> otherConditions required" rule are enforced via refine().
 */
export const adultIntakeSchema = z
  .object({
    physicalActivityLevel: z.nativeEnum(PhysicalActivityLevel).optional().nullable(),
    // Optional — the label has always said «إن وجد» (NI-4, Prompt 38); the
    // column is nullable and the view renders the empty answer as "—".
    medicalDiagnosis: z.string().max(2000).optional().or(z.literal('')).nullable(),
    primaryComplaint: z.string().max(2000).optional().or(z.literal('')).nullable(),
    painTiming: z.nativeEnum(PainTiming).optional().nullable(),
    symptomDuration: z.nativeEnum(SymptomDuration).optional().nullable(),
    painSeverity: z.nativeEnum(PainSeverity).optional().nullable(),
    painAggravatingFactors: z.string().max(1000).optional().or(z.literal('')).nullable(),
    painRelievingFactors: z.string().max(1000).optional().or(z.literal('')).nullable(),
    painStability: z.nativeEnum(PainStability).optional().nullable(),
    currentMedicationsForProblem: z.string().max(1000).optional().or(z.literal('')).nullable(),
    otherMedications: z.string().max(1000).optional().or(z.literal('')).nullable(),
    conditions: z
      .array(z.nativeEnum(Comorbidity))
      .nullable()
      .default([])
      .transform((v) => v ?? []),
    otherConditions: z.string().max(500).optional().or(z.literal('')).nullable(),
    previousFractures: z.string().max(500).optional().or(z.literal('')).nullable(),
    previousSurgeries: z.string().max(500).optional().or(z.literal('')).nullable(),
    previousPtExperience: z.string().max(500).optional().or(z.literal('')).nullable(),
    referralSource: z.nativeEnum(ReferralSource).optional().nullable(),
    /**
     * Custom-question answers — keyed by question id. Validation against the
     * active question set is done at the action layer via
     * lib/intake/buildCustomQuestionSchema.
     */
    customAnswers: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (v) => {
      // Section F mutual exclusion: NONE may not coexist with any other.
      if (v.conditions.includes(Comorbidity.NONE) && v.conditions.length > 1) {
        return false;
      }
      return true;
    },
    { message: 'noneExclusive', path: ['conditions'] },
  )
  .refine(
    (v) => {
      // OTHER → otherConditions required.
      if (v.conditions.includes(Comorbidity.OTHER) && !v.otherConditions) {
        return false;
      }
      return true;
    },
    { message: 'otherConditionsRequired', path: ['otherConditions'] },
  );

export type AdultIntakeInput = z.infer<typeof adultIntakeSchema>;

export const pediatricIntakeSchema = z
  .object({
    // P64 #8 — no longer asked on new intakes; kept optional for old payloads.
    numberOfSiblings: z.coerce.number().int().min(0).max(20).optional().nullable(),
    birthOrder: z.coerce.number().int().min(1).max(21).optional().nullable(),
    customAnswers: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (v) =>
      v.birthOrder == null || v.numberOfSiblings == null || v.birthOrder <= v.numberOfSiblings + 1,
    {
      message: 'birthOrderTooHigh',
      path: ['birthOrder'],
    },
  );

export type PediatricIntakeInput = z.infer<typeof pediatricIntakeSchema>;

export const intakeTypeSchema = z.nativeEnum(IntakeType);
