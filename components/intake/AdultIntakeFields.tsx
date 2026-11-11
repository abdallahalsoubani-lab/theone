'use client';

import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { IntakeCustomQuestionsCard } from '@/components/intake/IntakeCustomQuestionsCard';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';

interface Props {
  form: UseFormReturn<FieldValues>;
  customQuestions: CustomQuestionRow[];
  locale: 'en' | 'ar';
  /**
   * RHF name prefix. '' for the secretary form (flat values); 'answers.' for
   * the public form (intake answers nested under `answers`). This is the one
   * lever that lets the SAME question fields drive both surfaces.
   */
  namePrefix?: string;
}

/**
 * Adult intake question fields, shared by the staff form and the public /
 * personal-link forms (Prompt 23) so every surface asks the same questions.
 *
 * P64 #8 — the hard-coded Google-Form sections (activity, diagnosis, pain,
 * medication, conditions, history, referral) were RETIRED: the clinic manages
 * its intake entirely as admin custom questions («الأسئلة الإضافية»), which had
 * re-created those same topics, so patients were asked everything twice.
 * Only the active admin questions render now. Historical intakes keep their
 * stored fixed answers (nullable columns) and still display them.
 */
export function AdultIntakeFields({ form, customQuestions, locale, namePrefix = '' }: Props) {
  return (
    <IntakeCustomQuestionsCard
      form={form}
      customQuestions={customQuestions}
      locale={locale}
      namePrefix={namePrefix}
      namespace="intake.adult"
    />
  );
}

// enumOptions / pascal / severitySuffix live in lib/intake/display.ts — the
// read-only views still localize historical fixed answers with them.
