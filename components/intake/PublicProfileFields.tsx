'use client';

import { Gender, LanguagePref } from '@prisma/client';
import { useTranslations } from 'next-intl';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import { SelectField, TextField, TextareaField } from '@/components/forms/FormFields';
import { DateField } from '@/components/forms/DateField';
import { Card, CardContent } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  form: UseFormReturn<FieldValues>;
  /** Always 'profile.' for the public form. */
  namePrefix?: string;
}

/**
 * Native language names are locale-invariant proper nouns — the established
 * precedent from `PatientForm`'s language options.
 */
const LANGUAGE_OPTIONS = [
  { value: LanguagePref.AR, label: 'العربية' },
  { value: LanguagePref.EN, label: 'English' },
] as const;

/**
 * Identifying-fields section of the public intake form (Prompt 23). These
 * drive patient creation on approval (each name → its own name column, phone
 * for duplicate detection, DOB/gender). Two name fields per QA 13/7 item 5.2 —
 * the Arabic name is required, the English one optional (approval falls back
 * to the AR name). Address is optional too (PT-B4 item 2).
 * The preferred-language radio (QA 5.3) is the patient's explicit choice for
 * WhatsApp + portal language; the host form defaults it to the form locale.
 */
export function PublicProfileFields({ form, namePrefix = 'profile.' }: Props) {
  const t = useTranslations('publicIntake');
  const n = (s: string) => `${namePrefix}${s}` as never;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-lg font-medium text-brand-navy">{t('sectionAbout')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            form={form}
            name={n('fullNameEn')}
            label={t('fullNameEn')}
            autoComplete="name"
          />
        </div>
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
          <DateField form={form} name={n('dateOfBirth')} label={t('dateOfBirth')} />
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
        <FormField
          control={form.control}
          name={n('languagePref')}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('languagePref')}</FormLabel>
              <FormControl>
                <div className="flex flex-wrap gap-4 rounded-md border border-input bg-background p-3">
                  {LANGUAGE_OPTIONS.map((o) => {
                    const id = `lang-${namePrefix}${o.value}`;
                    return (
                      <Label
                        key={o.value}
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                      >
                        <Input
                          id={id}
                          type="radio"
                          name={n('languagePref')}
                          checked={field.value === o.value}
                          onChange={() => field.onChange(o.value)}
                          className="size-4 cursor-pointer accent-brand-cyan"
                        />
                        <span>{o.label}</span>
                      </Label>
                    );
                  })}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* Optional (PT-B4 item 2) — labelled the same way as the email field,
            which is the project's only marker for a non-required input. */}
        <TextareaField form={form} name={n('address')} label={t('addressOptional')} rows={2} />
      </CardContent>
    </Card>
  );
}
