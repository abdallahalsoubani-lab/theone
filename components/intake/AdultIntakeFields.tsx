'use client';

import {
  Comorbidity,
  PainSeverity,
  PainStability,
  PainTiming,
  PhysicalActivityLevel,
  ReferralSource,
  SymptomDuration,
} from '@prisma/client';
import { useTranslations } from 'next-intl';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { SelectField, TextareaField } from '@/components/forms/FormFields';
import { CustomQuestionField } from '@/components/intake/CustomQuestionField';
import { Card, CardContent } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
 * Adult intake question fields — Sections B–H of Prompt 6 §4.4. Extracted so
 * the secretary form and the public self-service form (Prompt 23) render the
 * EXACT same questions from the EXACT same schema. Section A (profile) is
 * owned by each host form. NONE/OTHER mutual exclusion is enforced here at the
 * UI level and again in `adultIntakeSchema`.
 */
export function AdultIntakeFields({ form, customQuestions, locale, namePrefix = '' }: Props) {
  const t = useTranslations('intake.adult');
  const n = (s: string) => `${namePrefix}${s}` as never;

  const conditions = (form.watch(n('conditions')) ?? []) as Comorbidity[];
  const otherChecked = conditions.includes(Comorbidity.OTHER);
  const noneChecked = conditions.includes(Comorbidity.NONE);

  const toggleCondition = (c: Comorbidity) => {
    let next: Comorbidity[];
    if (c === Comorbidity.NONE) {
      next = noneChecked ? [] : [Comorbidity.NONE];
    } else if (noneChecked) {
      next = [c];
    } else if (conditions.includes(c)) {
      next = conditions.filter((x) => x !== c);
    } else {
      next = [...conditions, c];
    }
    form.setValue(n('conditions'), next as never, { shouldDirty: true });
  };

  return (
    <>
      {/* Section B — activity */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('sectionActivity')}</h2>
          <SelectField
            form={form}
            name={n('physicalActivityLevel')}
            label={t('physicalActivityLevel')}
            options={enumOptions(PhysicalActivityLevel, (v) => t(`activity${pascal(v)}`))}
          />
        </CardContent>
      </Card>

      {/* Section C — diagnosis */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('sectionDiagnosis')}</h2>
          <TextareaField
            form={form}
            name={n('medicalDiagnosis')}
            label={t('medicalDiagnosis')}
            rows={2}
          />
          <TextareaField
            form={form}
            name={n('primaryComplaint')}
            label={t('primaryComplaint')}
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Section D — pain */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('sectionPain')}</h2>
          <SelectField
            form={form}
            name={n('painTiming')}
            label={t('painTiming')}
            options={enumOptions(PainTiming, (v) => t(`timing${pascal(v)}`))}
          />
          <SelectField
            form={form}
            name={n('symptomDuration')}
            label={t('symptomDuration')}
            options={enumOptions(SymptomDuration, (v) => t(`duration${pascal(v)}`))}
          />
          <SelectField
            form={form}
            name={n('painSeverity')}
            label={t('painSeverity')}
            options={enumOptions(PainSeverity, (v) => t(`severity${severitySuffix(v)}`))}
          />
          <TextareaField
            form={form}
            name={n('painAggravatingFactors')}
            label={t('painAggravatingFactors')}
            rows={2}
          />
          <TextareaField
            form={form}
            name={n('painRelievingFactors')}
            label={t('painRelievingFactors')}
            rows={2}
          />
          <SelectField
            form={form}
            name={n('painStability')}
            label={t('painStability')}
            options={enumOptions(PainStability, (v) => t(`stability${pascal(v)}`))}
          />
        </CardContent>
      </Card>

      {/* Section E — medications */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('sectionMedications')}</h2>
          <TextareaField
            form={form}
            name={n('currentMedicationsForProblem')}
            label={t('currentMedicationsForProblem')}
            rows={2}
          />
          <TextareaField
            form={form}
            name={n('otherMedications')}
            label={t('otherMedications')}
            rows={2}
          />
        </CardContent>
      </Card>

      {/* Section F — history (conditions checkbox group with NONE/OTHER rules) */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('sectionHistory')}</h2>
          <FormField
            control={form.control}
            name={n('conditions')}
            render={() => (
              <FormItem>
                <FormLabel>{t('conditions')}</FormLabel>
                <FormControl>
                  <div className="grid gap-2 rounded-md border border-input bg-background p-3 sm:grid-cols-2">
                    {(Object.values(Comorbidity) as Comorbidity[]).map((c) => {
                      const id = `cond-${namePrefix}${c}`;
                      const isNone = c === Comorbidity.NONE;
                      const disabled = noneChecked && !isNone;
                      return (
                        <Label
                          key={c}
                          htmlFor={id}
                          className={`flex cursor-pointer items-center gap-2 text-sm font-normal ${
                            disabled ? 'opacity-50' : ''
                          }`}
                        >
                          <Input
                            id={id}
                            type="checkbox"
                            className="size-4 cursor-pointer accent-brand-cyan"
                            checked={conditions.includes(c)}
                            disabled={disabled}
                            onChange={() => toggleCondition(c)}
                          />
                          <span>{t(`condition${pascal(c)}`)}</span>
                        </Label>
                      );
                    })}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {otherChecked ? (
            <TextareaField
              form={form}
              name={n('otherConditions')}
              label={t('otherConditions')}
              rows={2}
            />
          ) : null}
          <TextareaField
            form={form}
            name={n('previousFractures')}
            label={t('previousFractures')}
            rows={2}
          />
          <TextareaField
            form={form}
            name={n('previousSurgeries')}
            label={t('previousSurgeries')}
            rows={2}
          />
          <TextareaField
            form={form}
            name={n('previousPtExperience')}
            label={t('previousPtExperience')}
            rows={2}
          />
        </CardContent>
      </Card>

      {/* Section G — referral */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('sectionReferral')}</h2>
          <SelectField
            form={form}
            name={n('referralSource')}
            label={t('referralSource')}
            options={enumOptions(ReferralSource, (v) => t(`referral${pascal(v)}`))}
          />
        </CardContent>
      </Card>

      {/* Section H — custom questions */}
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

function enumOptions<E extends Record<string, string>>(
  e: E,
  label: (v: E[keyof E]) => string,
): Array<{ value: string; label: string }> {
  return (Object.values(e) as Array<E[keyof E]>).map((v) => ({
    value: v as string,
    label: label(v),
  }));
}

function pascal(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

function severitySuffix(v: PainSeverity): string {
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
