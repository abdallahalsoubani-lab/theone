'use client';

import { useTranslations } from 'next-intl';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { CustomQuestionField } from '@/components/intake/CustomQuestionField';
import { Card, CardContent } from '@/components/ui/card';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';

/**
 * The intake questionnaire body (P64 #8): the clinic's ACTIVE admin-managed
 * questions, in their configured order, under the «الأسئلة الإضافية» heading.
 * Archived (inactive) questions never render — callers pass the active set,
 * and this filters again as a belt-and-braces guard.
 */
export function IntakeCustomQuestionsCard({
  form,
  customQuestions,
  locale,
  namePrefix,
  namespace,
}: {
  form: UseFormReturn<FieldValues>;
  customQuestions: CustomQuestionRow[];
  locale: 'en' | 'ar';
  namePrefix: string;
  namespace: 'intake.adult' | 'intake.pediatric';
}) {
  const t = useTranslations(namespace);
  const questions = customQuestions.filter((q) => q.active);
  if (questions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-brand-textMuted">{t('noQuestions')}</CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-medium text-brand-navy">{t('sectionCustom')}</h2>
        {questions.map((q) => (
          <CustomQuestionField
            key={q.id}
            form={form}
            question={q}
            locale={locale}
            name={`${namePrefix}customAnswers.${q.id}` as never}
          />
        ))}
      </CardContent>
    </Card>
  );
}
