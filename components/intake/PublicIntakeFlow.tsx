'use client';

import {
  Comorbidity,
  Gender,
  PainSeverity,
  PainStability,
  PainTiming,
  PhysicalActivityLevel,
  ReferralSource,
  SymptomDuration,
} from '@prisma/client';
import { Baby, CheckCircle2, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { AppForm } from '@/components/forms/AppForm';
import { AdultIntakeFields } from '@/components/intake/AdultIntakeFields';
import { PediatricIntakeFields } from '@/components/intake/PediatricIntakeFields';
import { PublicProfileFields } from '@/components/intake/PublicProfileFields';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';
import { submitPublicIntakeAction } from '@/lib/intake-submissions/publicActions';
import {
  publicAdultSubmissionSchema,
  publicPediatricSubmissionSchema,
} from '@/lib/intake-submissions/schemas';

interface Props {
  locale: 'en' | 'ar';
  adultQuestions: CustomQuestionRow[];
  pediatricQuestions: CustomQuestionRow[];
}

type Step = 'choose' | 'adult' | 'pediatric' | 'done';

const ADULT_ANSWER_DEFAULTS = {
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

const PEDIATRIC_ANSWER_DEFAULTS = {
  numberOfSiblings: 0,
  birthOrder: 1,
  customAnswers: {},
};

const emptyProfile = {
  fullName: '',
  phone: '',
  dateOfBirth: '',
  gender: Gender.MALE,
  address: '',
  email: '',
};

export function PublicIntakeFlow({ locale, adultQuestions, pediatricQuestions }: Props) {
  const t = useTranslations('publicIntake');
  const tCommon = useTranslations('common');
  const [step, setStep] = useState<Step>('choose');

  if (step === 'done') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <CheckCircle2 className="size-12 text-brand-teal" />
          <h2 className="text-xl font-semibold text-brand-navy">{t('thankYouTitle')}</h2>
          <p className="max-w-md text-sm text-brand-textMuted">{t('thankYouBody')}</p>
          <Button type="button" variant="outline" onClick={() => setStep('choose')}>
            {t('submitAnother')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === 'choose') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-brand-textMuted">{t('chooseHelp')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceCard
            icon={<User className="size-8 text-brand-cyan" />}
            label={t('chooseAdult')}
            description={t('chooseAdultHelp')}
            onClick={() => setStep('adult')}
          />
          <ChoiceCard
            icon={<Baby className="size-8 text-brand-teal" />}
            label={t('chooseChild')}
            description={t('chooseChildHelp')}
            onClick={() => setStep('pediatric')}
          />
        </div>
      </div>
    );
  }

  const isAdult = step === 'adult';

  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" size="sm" onClick={() => setStep('choose')}>
        ← {t('back')}
      </Button>
      {isAdult ? (
        <AppForm
          schema={publicAdultSubmissionSchema}
          defaultValues={
            {
              type: 'ADULT',
              locale,
              website: '',
              profile: emptyProfile,
              answers: ADULT_ANSWER_DEFAULTS,
            } as never
          }
          action={(values) => submitPublicIntakeAction(values)}
          successToast={t('thankYouTitle')}
          onSuccess={() => setStep('done')}
        >
          {(form) => (
            <div className="space-y-6">
              <Honeypot form={form as unknown as UseFormReturn<FieldValues>} />
              <PublicProfileFields form={form as unknown as UseFormReturn<FieldValues>} />
              <AdultIntakeFields
                form={form as unknown as UseFormReturn<FieldValues>}
                customQuestions={adultQuestions}
                locale={locale}
                namePrefix="answers."
              />
              <SubmitBar pending={form.formState.isSubmitting} label={tCommon('save')} />
            </div>
          )}
        </AppForm>
      ) : (
        <AppForm
          schema={publicPediatricSubmissionSchema}
          defaultValues={
            {
              type: 'PEDIATRIC',
              locale,
              website: '',
              profile: emptyProfile,
              answers: PEDIATRIC_ANSWER_DEFAULTS,
            } as never
          }
          action={(values) => submitPublicIntakeAction(values)}
          successToast={t('thankYouTitle')}
          onSuccess={() => setStep('done')}
        >
          {(form) => (
            <div className="space-y-6">
              <Honeypot form={form as unknown as UseFormReturn<FieldValues>} />
              <PublicProfileFields form={form as unknown as UseFormReturn<FieldValues>} />
              <PediatricIntakeFields
                form={form as unknown as UseFormReturn<FieldValues>}
                customQuestions={pediatricQuestions}
                locale={locale}
                namePrefix="answers."
              />
              <SubmitBar pending={form.formState.isSubmitting} label={tCommon('save')} />
            </div>
          )}
        </AppForm>
      )}
    </div>
  );
}

function ChoiceCard({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-lg border border-brand-border bg-brand-surface p-8 text-center transition hover:border-brand-cyan hover:shadow-sm"
    >
      {icon}
      <span className="text-lg font-medium text-brand-navy">{label}</span>
      <span className="text-sm text-brand-textMuted">{description}</span>
    </button>
  );
}

/**
 * Hidden honeypot field. A human never sees or fills it; a scripted submit that
 * fills every input trips it and the server silently drops the row. Positioned
 * off-screen (not display:none, which some bots skip) and excluded from tab
 * order + a11y tree.
 */
function Honeypot({ form }: { form: UseFormReturn<FieldValues> }) {
  return (
    <input
      type="text"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      className="absolute -left-[9999px] top-0 h-0 w-0 opacity-0"
      {...form.register('website' as never)}
    />
  );
}

function SubmitBar({ pending, label }: { pending: boolean; label: string }) {
  return (
    <div className="sticky bottom-2 flex items-center justify-end rounded-md border border-brand-border bg-brand-surface/95 p-3 backdrop-blur">
      <Button type="submit" disabled={pending}>
        {label}
      </Button>
    </div>
  );
}
