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
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { AppForm } from '@/components/forms/AppForm';
import { AdultIntakeFields } from '@/components/intake/AdultIntakeFields';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
 * Adult intake form — Prompt 6 §4.4. Section A (profile crosscheck) is
 * read-only; Sections B–H are the structured questions, rendered by the shared
 * <AdultIntakeFields/> so the secretary and public (Prompt 23) surfaces stay
 * byte-for-byte identical.
 */
export function AdultIntakeForm({ patient, customQuestions }: Props) {
  const tIntake = useTranslations('intake');
  const tCommon = useTranslations('common');
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
      {(form) => (
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

          <AdultIntakeFields
            form={form as unknown as UseFormReturn<FieldValues>}
            customQuestions={customQuestions}
            locale={intlLocale}
          />

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
