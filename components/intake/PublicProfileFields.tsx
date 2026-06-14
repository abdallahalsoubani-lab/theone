'use client';

import { Gender } from '@prisma/client';
import { useTranslations } from 'next-intl';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { SelectField, TextField, TextareaField } from '@/components/forms/FormFields';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  form: UseFormReturn<FieldValues>;
  /** Always 'profile.' for the public form. */
  namePrefix?: string;
}

/**
 * Identifying-fields section of the public intake form (Prompt 23). These
 * drive patient creation on approval (name → both name fields, phone for
 * duplicate detection, DOB/gender/address required by the patient-create
 * service). One name field per the confirmed decision — the secretary can
 * transliterate the other half at review.
 */
export function PublicProfileFields({ form, namePrefix = 'profile.' }: Props) {
  const t = useTranslations('publicIntake');
  const n = (s: string) => `${namePrefix}${s}` as never;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-medium text-brand-navy">{t('sectionAbout')}</h2>
        <TextField form={form} name={n('fullName')} label={t('fullName')} autoComplete="name" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            form={form}
            name={n('phone')}
            label={t('phone')}
            type="tel"
            inputMode="tel"
            placeholder="07XXXXXXXX"
            description={t('phoneHint')}
            autoComplete="tel"
          />
          <TextField
            form={form}
            name={n('dateOfBirth')}
            label={t('dateOfBirth')}
            type="text"
            inputMode="numeric"
            placeholder="YYYY-MM-DD"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            form={form}
            name={n('gender')}
            label={t('gender')}
            options={[
              { value: Gender.MALE, label: t('genderMale') },
              { value: Gender.FEMALE, label: t('genderFemale') },
            ]}
          />
          <TextField
            form={form}
            name={n('email')}
            label={t('emailOptional')}
            type="email"
            inputMode="email"
            autoComplete="email"
          />
        </div>
        <TextareaField form={form} name={n('address')} label={t('address')} rows={2} />
      </CardContent>
    </Card>
  );
}
