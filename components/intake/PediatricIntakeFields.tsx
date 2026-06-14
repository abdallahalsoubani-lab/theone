'use client';

import { useTranslations } from 'next-intl';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { TextField } from '@/components/forms/FormFields';
import { CustomQuestionField } from '@/components/intake/CustomQuestionField';
import { Card, CardContent } from '@/components/ui/card';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';

interface Props {
  form: UseFormReturn<FieldValues>;
  customQuestions: CustomQuestionRow[];
  locale: 'en' | 'ar';
  /** '' for the secretary form, 'answers.' for the public form. */
  namePrefix?: string;
}

/**
 * Pediatric intake question fields — Prompt 6 §4.5. Shared by the secretary
 * form and the public self-service form (Prompt 23) so both render the same
 * questions from `pediatricIntakeSchema`.
 */
export function PediatricIntakeFields({ form, customQuestions, locale, namePrefix = '' }: Props) {
  const t = useTranslations('intake.pediatric');
  const n = (s: string) => `${namePrefix}${s}` as never;

  return (
    <>
      {/* Section B — pediatric-specific */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('sectionFamily')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              form={form}
              name={n('numberOfSiblings')}
              label={t('numberOfSiblings')}
              type="number"
              inputMode="numeric"
            />
            <TextField
              form={form}
              name={n('birthOrder')}
              label={t('birthOrder')}
              type="number"
              inputMode="numeric"
              description={t('birthOrderHelp')}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section C — custom questions */}
      {customQuestions.length > 0 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-medium text-brand-navy">{t('sectionCustom')}</h2>
            {customQuestions.map((q) => (
              <CustomQuestionField
                key={q.id}
                form={form}
                question={q}
                locale={locale}
                name={n(`customAnswers.${q.id}`)}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
