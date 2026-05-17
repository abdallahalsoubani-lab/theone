'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { AppForm } from '@/components/forms/AppForm';
import { TextField } from '@/components/forms/FormFields';
import { CustomQuestionField } from '@/components/intake/CustomQuestionField';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';
import { createPediatricIntakeAction } from '@/lib/intake/actions';
import { pediatricIntakeSchema, type PediatricIntakeInput } from '@/lib/intake/schemas';
import { formatDate } from '@/lib/format/date';
import type { PatientFileData } from '@/lib/patients/queries';

interface Props {
  patient: PatientFileData;
  customQuestions: CustomQuestionRow[];
}

/**
 * Pediatric intake — Prompt 6 §4.5. Two pediatric-specific fields
 * (numberOfSiblings, birthOrder) plus active Custom Questions whose
 * `appliesTo` is PEDIATRIC or BOTH. Section A is read-only profile
 * crosscheck identical to the Adult form.
 */
export function PediatricIntakeForm({ patient, customQuestions }: Props) {
  const t = useTranslations('intake.pediatric');
  const tIntake = useTranslations('intake');
  const tCommon = useTranslations('common');
  const tPatients = useTranslations('patients.form');
  const router = useRouter();
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';

  const defaultValues: PediatricIntakeInput = {
    numberOfSiblings: 0,
    birthOrder: 1,
    customAnswers: {},
  };

  return (
    <AppForm
      schema={pediatricIntakeSchema}
      defaultValues={defaultValues as never}
      action={(values) =>
        createPediatricIntakeAction({
          patientId: patient.id,
          data: values as PediatricIntakeInput,
        })
      }
      successToast={tIntake('completedToast')}
      onSuccess={() => {
        router.push(`/${locale}/secretary/patients/${patient.id}`);
      }}
    >
      {(form) => (
        <div className="space-y-6">
          {/* Section A — profile crosscheck */}
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
                <ReadField label={tPatients('fullNameAr')} value={patient.fullNameAr} />
                <ReadField
                  label={tPatients('dateOfBirth')}
                  value={formatDate(patient.dateOfBirth, intlLocale)}
                />
                <ReadField label={tPatients('gender')} value={patient.gender} />
                <ReadField label={tPatients('phone')} value={patient.phone} />
              </div>
            </CardContent>
          </Card>

          {/* Section B — pediatric-specific */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-medium text-brand-navy">{t('sectionFamily')}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  form={form}
                  name={'numberOfSiblings' as never}
                  label={t('numberOfSiblings')}
                  type="number"
                  inputMode="numeric"
                />
                <TextField
                  form={form}
                  name={'birthOrder' as never}
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
      )}
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
