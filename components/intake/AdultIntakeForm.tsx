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
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { AppForm } from '@/components/forms/AppForm';
import { SelectField, TextareaField } from '@/components/forms/FormFields';
import { CustomQuestionField } from '@/components/intake/CustomQuestionField';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';
import { createAdultIntakeAction } from '@/lib/intake/actions';
import { adultIntakeSchema, type AdultIntakeInput } from '@/lib/intake/schemas';
import { formatDate } from '@/lib/format/date';
import type { PatientFileData } from '@/lib/patients/queries';

interface Props {
  patient: PatientFileData;
  customQuestions: CustomQuestionRow[];
}

/**
 * Adult intake form — Prompt 6 §4.4. Long single-page layout with clear
 * section headers. Section A (profile crosscheck) is read-only; sections
 * B–G are the structured Google-Form questions; section H is dynamic
 * Custom Questions (ADULT or BOTH, active).
 *
 * NONE/OTHER mutual exclusion is enforced both at the schema level
 * (adultIntakeSchema.refine) and at the UI level (selecting NONE clears
 * the rest; selecting any other unchecks NONE).
 */
export function AdultIntakeForm({ patient, customQuestions }: Props) {
  const t = useTranslations('intake.adult');
  const tCommon = useTranslations('common');
  const tIntake = useTranslations('intake');
  const tPatients = useTranslations('patients.form');
  const router = useRouter();
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  const defaultValues: AdultIntakeInput = {
    physicalActivityLevel: PhysicalActivityLevel.MODERATE,
    medicalDiagnosis: '',
    primaryComplaint: '',
    painTiming: PainTiming.DAY,
    symptomDuration: SymptomDuration.WEEKS_2_3,
    painSeverity: PainSeverity.FIVE,
    painAggravatingFactors: null,
    painRelievingFactors: null,
    painStability: PainStability.CONSTANT,
    currentMedicationsForProblem: null,
    otherMedications: null,
    conditions: [Comorbidity.NONE],
    otherConditions: null,
    previousFractures: null,
    previousSurgeries: null,
    previousPtExperience: null,
    referralSource: ReferralSource.FRIEND_FAMILY,
    customAnswers: {},
  };

  return (
    <AppForm
      schema={adultIntakeSchema}
      defaultValues={defaultValues as never}
      action={(values) =>
        createAdultIntakeAction({
          patientId: patient.id,
          data: values as AdultIntakeInput,
        })
      }
      successToast={tIntake('completedToast')}
      onSuccess={() => {
        router.push(`/${locale}/secretary/patients/${patient.id}`);
      }}
    >
      {(form) => {
        const conditions = (form.watch('conditions' as never) ?? []) as Comorbidity[];
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
          form.setValue('conditions' as never, next as never, { shouldDirty: true });
        };

        return (
          <div className="space-y-6">
            {/* Section A — profile crosscheck (read-only) */}
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-medium text-brand-navy">
                    {tIntake('profileCrosscheck')}
                  </h2>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/secretary/patients/${patient.id}/edit`}>
                      {tPatients('editTitle')}
                    </Link>
                  </Button>
                </div>
                <p className="text-xs text-brand-textMuted">{tIntake('profileCrosscheckHelp')}</p>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <ReadField label={tPatients('fullNameEn')} value={patient.fullNameEn} />
                  <ReadField label={tPatients('fullNameAr')} value={patient.fullNameAr} />
                  <ReadField
                    label={tPatients('dateOfBirth')}
                    value={formatDate(patient.dateOfBirth, intlLocale)}
                  />
                  <ReadField label={tPatients('gender')} value={patient.gender} />
                  <ReadField label={tPatients('phone')} value={patient.phone} />
                  <ReadField label={tPatients('address')} value={patient.address} />
                </div>
              </CardContent>
            </Card>

            {/* Section B — activity */}
            <Card>
              <CardContent className="space-y-4 p-6">
                <h2 className="text-lg font-medium text-brand-navy">{t('sectionActivity')}</h2>
                <SelectField
                  form={form}
                  name={'physicalActivityLevel' as never}
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
                  name={'medicalDiagnosis' as never}
                  label={t('medicalDiagnosis')}
                  rows={2}
                />
                <TextareaField
                  form={form}
                  name={'primaryComplaint' as never}
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
                  name={'painTiming' as never}
                  label={t('painTiming')}
                  options={enumOptions(PainTiming, (v) => t(`timing${pascal(v)}`))}
                />
                <SelectField
                  form={form}
                  name={'symptomDuration' as never}
                  label={t('symptomDuration')}
                  options={enumOptions(SymptomDuration, (v) => t(`duration${pascal(v)}`))}
                />
                <SelectField
                  form={form}
                  name={'painSeverity' as never}
                  label={t('painSeverity')}
                  options={enumOptions(PainSeverity, (v) => t(`severity${severitySuffix(v)}`))}
                />
                <TextareaField
                  form={form}
                  name={'painAggravatingFactors' as never}
                  label={t('painAggravatingFactors')}
                  rows={2}
                />
                <TextareaField
                  form={form}
                  name={'painRelievingFactors' as never}
                  label={t('painRelievingFactors')}
                  rows={2}
                />
                <SelectField
                  form={form}
                  name={'painStability' as never}
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
                  name={'currentMedicationsForProblem' as never}
                  label={t('currentMedicationsForProblem')}
                  rows={2}
                />
                <TextareaField
                  form={form}
                  name={'otherMedications' as never}
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
                  name={'conditions' as never}
                  render={() => (
                    <FormItem>
                      <FormLabel>{t('conditions')}</FormLabel>
                      <FormControl>
                        <div className="grid gap-2 rounded-md border border-input bg-background p-3 sm:grid-cols-2">
                          {(Object.values(Comorbidity) as Comorbidity[]).map((c) => {
                            const id = `cond-${c}`;
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
                    name={'otherConditions' as never}
                    label={t('otherConditions')}
                    rows={2}
                  />
                ) : null}
                <TextareaField
                  form={form}
                  name={'previousFractures' as never}
                  label={t('previousFractures')}
                  rows={2}
                />
                <TextareaField
                  form={form}
                  name={'previousSurgeries' as never}
                  label={t('previousSurgeries')}
                  rows={2}
                />
                <TextareaField
                  form={form}
                  name={'previousPtExperience' as never}
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
                  name={'referralSource' as never}
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
                      locale={intlLocale}
                      name={`customAnswers.${q.id}` as never}
                    />
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <div className="sticky bottom-2 flex items-center justify-end gap-2 rounded-md border border-brand-border bg-brand-surface/95 p-3 backdrop-blur">
              <Button asChild variant="outline" type="button">
                <Link href={`/secretary/patients/${patient.id}`}>{tCommon('cancel')}</Link>
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {tCommon('save')}
              </Button>
            </div>
          </div>
        );
      }}
    </AppForm>
  );
}

function ReadField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">{label}</p>
      <p className="text-sm text-brand-text">{value ?? '—'}</p>
    </div>
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
