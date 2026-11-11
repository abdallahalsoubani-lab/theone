'use client';

import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { IntakeCustomQuestionsCard } from '@/components/intake/IntakeCustomQuestionsCard';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';

interface Props {
  form: UseFormReturn<FieldValues>;
  customQuestions: CustomQuestionRow[];
  locale: 'en' | 'ar';
  /** '' for the secretary form, 'answers.' for the public form. */
  namePrefix?: string;
}

/**
 * Pediatric intake question fields — shared by the staff form and the public
 * / personal-link forms (Prompt 23).
 *
 * P64 #8 — the hard-coded "Family" section (siblings, birth order) was
 * retired: only the active admin custom questions render. Historical intakes
 * keep their stored answers and still display them.
 */
export function PediatricIntakeFields({ form, customQuestions, locale, namePrefix = '' }: Props) {
  return (
    <IntakeCustomQuestionsCard
      form={form}
      customQuestions={customQuestions}
      locale={locale}
      namePrefix={namePrefix}
      namespace="intake.pediatric"
    />
  );
}
