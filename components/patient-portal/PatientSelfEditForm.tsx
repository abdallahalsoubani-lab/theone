'use client';

import { LanguagePref } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { AppForm } from '@/components/forms/AppForm';
import { SelectField, SwitchField, TextField, TextareaField } from '@/components/forms/FormFields';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { updateOwnProfileAction } from '@/lib/patients/actions';
import { patientSelfEditSchema, type PatientSelfEditInput } from '@/lib/patients/schemas';
import { formatPhone } from '@/lib/format/phone';

interface Props {
  initial: PatientSelfEditInput;
  readOnly: {
    fullNameEn: string;
    fullNameAr: string;
    phone: string;
    dateOfBirth: Date;
    gender: string;
  };
}

/**
 * Patient self-edit form — narrow field subset per Prompt 6 §4.7. Name /
 * DOB / gender / national ID / clinical fields stay read-only with a
 * footer note telling the patient to contact the clinic to change them.
 */
export function PatientSelfEditForm({ initial, readOnly }: Props) {
  const t = useTranslations('patients.form');
  const tPortal = useTranslations('patient.portal');
  const router = useRouter();
  const locale = useLocale();

  const languageOptions = [
    { value: LanguagePref.AR, label: 'العربية' },
    { value: LanguagePref.EN, label: 'English' },
  ];

  return (
    <AppForm
      schema={patientSelfEditSchema}
      defaultValues={initial as never}
      action={(values) => updateOwnProfileAction(values as PatientSelfEditInput)}
      successToast={tPortal('saved')}
      onSuccess={() => router.refresh()}
    >
      {(form) => (
        <div className="space-y-6">
          <Card>
            <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
              <ReadField label={t('fullNameEn')} value={readOnly.fullNameEn} />
              <ReadField label={t('fullNameAr')} value={readOnly.fullNameAr} />
              <ReadField label={t('phone')} value={formatPhone(readOnly.phone)} />
              <ReadField
                label={t('dateOfBirth')}
                value={readOnly.dateOfBirth.toISOString().slice(0, 10)}
              />
              <ReadField label={t('gender')} value={readOnly.gender} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-6">
              <TextField
                form={form}
                name={'email' as never}
                label={t('email')}
                type="email"
                autoComplete="email"
              />
              <TextareaField form={form} name={'address' as never} label={t('address')} rows={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  form={form}
                  name={'emergencyContactName' as never}
                  label={t('emergencyContactName')}
                />
                <TextField
                  form={form}
                  name={'emergencyContactPhone' as never}
                  label={t('emergencyContactPhone')}
                  type="tel"
                  inputMode="tel"
                  placeholder="+9627XXXXXXXX"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  form={form}
                  name={'languagePref' as never}
                  label={t('languagePref')}
                  options={languageOptions}
                />
                <SwitchField
                  form={form}
                  name={'hijriCalendarPref' as never}
                  label={t('hijriCalendarPref')}
                />
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-brand-textMuted">{tPortal('readOnlyNotice')}</p>

          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="outline" type="button">
              <Link href="/patient/dashboard">{tPortal('save').replace(/.+/, '')}</Link>
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {tPortal('save')}
            </Button>
          </div>
        </div>
      )}
    </AppForm>
  );
  // suppress unused-import warning for locale
  void locale;
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">{label}</p>
      <p className="text-sm text-brand-text">{value}</p>
    </div>
  );
}
