'use client';

import { Gender, LanguagePref } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { z } from 'zod';

import { AppForm } from '@/components/forms/AppForm';
import { SelectField, SwitchField, TextField, TextareaField } from '@/components/forms/FormFields';
import { CareTeamEditor } from '@/components/patients/CareTeamEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { createPatientAction, updatePatientAction } from '@/lib/patients/actions';
import type { ClinicianRef } from '@/lib/patients/assignment';
import {
  patientCreateSchema,
  patientUpdateSchema,
  type PatientCreateInput,
} from '@/lib/patients/schemas';

interface CreateProps {
  mode: 'create';
  /** Full clinician option lists for the care-team multi-select. */
  therapists: ClinicianRef[];
  doctors: ClinicianRef[];
}

interface EditProps {
  mode: 'edit';
  initial: PatientCreateInput & { id: string };
}

type Props = CreateProps | EditProps;

export function PatientForm(props: Props) {
  const t = useTranslations('patients.form');
  const tCommon = useTranslations('common');
  const tPatients = useTranslations('patients.toasts');
  const router = useRouter();
  const locale = useLocale();

  const isEdit = props.mode === 'edit';
  const schema = isEdit ? patientUpdateSchema : patientCreateSchema;
  const defaults: PatientCreateInput = isEdit
    ? props.initial
    : {
        fullNameEn: '',
        fullNameAr: '',
        phone: '+9627',
        email: null,
        dateOfBirth: new Date(),
        gender: Gender.MALE,
        nationalId: null,
        address: '',
        occupation: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        languagePref: LanguagePref.AR,
        hijriCalendarPref: false,
        medicalHistorySummary: null,
        allergies: null,
        currentMedications: null,
        therapistIds: [],
        doctorIds: [],
      };
  const defaultValues = isEdit ? { id: props.initial.id, ...defaults } : defaults;

  const action = (values: z.infer<typeof patientCreateSchema | typeof patientUpdateSchema>) =>
    isEdit
      ? updatePatientAction(values as z.infer<typeof patientUpdateSchema>)
      : createPatientAction(values as z.infer<typeof patientCreateSchema>);

  return (
    <AppForm
      schema={schema}
      defaultValues={defaultValues as never}
      action={action as never}
      successToast={isEdit ? tPatients('updated') : tPatients('created')}
      onSuccess={(data) => {
        if (isEdit) {
          router.push(`/${locale}/secretary/patients/${(data as { patientId: string }).patientId}`);
          return;
        }
        const d = data as {
          patientId: string;
          tempPassword: string;
          whatsappStatus: 'SENT' | 'FAILED';
        };
        const url = new URL(
          `/${locale}/secretary/patients/${d.patientId}/created`,
          window.location.origin,
        );
        url.searchParams.set('p', d.tempPassword);
        url.searchParams.set('w', d.whatsappStatus);
        router.replace(url.pathname + url.search);
      }}
    >
      {(form) => {
        const genderOptions = [
          { value: Gender.MALE, label: t('genderMale') },
          { value: Gender.FEMALE, label: t('genderFemale') },
        ];
        const languageOptions = [
          { value: LanguagePref.AR, label: 'العربية' },
          { value: LanguagePref.EN, label: 'English' },
        ];

        return (
          <div className="space-y-6">
            <Card>
              <CardContent className="space-y-4 p-6">
                <h2 className="text-lg font-medium text-brand-navy">{t('sectionPersonal')}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField form={form} name={'fullNameEn' as never} label={t('fullNameEn')} />
                  <TextField form={form} name={'fullNameAr' as never} label={t('fullNameAr')} />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField
                    form={form}
                    name={'dateOfBirth' as never}
                    type="text"
                    label={t('dateOfBirth')}
                    placeholder="YYYY-MM-DD"
                  />
                  <SelectField
                    form={form}
                    name={'gender' as never}
                    label={t('gender')}
                    options={genderOptions}
                  />
                  <TextField form={form} name={'nationalId' as never} label={t('nationalId')} />
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

            <Card>
              <CardContent className="space-y-4 p-6">
                <h2 className="text-lg font-medium text-brand-navy">{t('sectionContact')}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    form={form}
                    name={'phone' as never}
                    label={t('phone')}
                    type="tel"
                    inputMode="tel"
                    placeholder="+9627XXXXXXXX"
                    description={isEdit ? t('phoneIsUsername') : undefined}
                  />
                  <TextField
                    form={form}
                    name={'email' as never}
                    label={t('email')}
                    type="email"
                    autoComplete="off"
                  />
                </div>
                <TextareaField
                  form={form}
                  name={'address' as never}
                  label={t('address')}
                  rows={2}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField form={form} name={'occupation' as never} label={t('occupation')} />
                  <TextField
                    form={form}
                    name={'emergencyContactName' as never}
                    label={t('emergencyContactName')}
                  />
                </div>
                <TextField
                  form={form}
                  name={'emergencyContactPhone' as never}
                  label={t('emergencyContactPhone')}
                  type="tel"
                  inputMode="tel"
                  placeholder="+9627XXXXXXXX"
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-6">
                <h2 className="text-lg font-medium text-brand-navy">{t('sectionClinical')}</h2>
                <TextareaField
                  form={form}
                  name={'medicalHistorySummary' as never}
                  label={t('medicalHistorySummary')}
                  rows={3}
                />
                <TextareaField
                  form={form}
                  name={'allergies' as never}
                  label={t('allergies')}
                  rows={2}
                />
                <TextareaField
                  form={form}
                  name={'currentMedications' as never}
                  label={t('currentMedications')}
                  rows={2}
                />
              </CardContent>
            </Card>

            {props.mode === 'create' ? (
              <Card>
                <CardContent className="space-y-4 p-6">
                  <h2 className="text-lg font-medium text-brand-navy">{t('sectionAssignment')}</h2>
                  <p className="text-sm text-brand-textMuted">{t('assignmentHelp')}</p>
                  <CareTeamEditor
                    therapistOptions={props.therapists}
                    doctorOptions={props.doctors}
                    therapists={props.therapists.filter((c) =>
                      (
                        form.watch('therapistIds' as never) as unknown as string[] | undefined
                      )?.includes(c.id),
                    )}
                    doctors={props.doctors.filter((c) =>
                      (
                        form.watch('doctorIds' as never) as unknown as string[] | undefined
                      )?.includes(c.id),
                    )}
                    onAdd={(clinicianId) => {
                      const isTherapist = props.therapists.some((c) => c.id === clinicianId);
                      const field = isTherapist ? 'therapistIds' : 'doctorIds';
                      const current =
                        (form.getValues(field as never) as unknown as string[] | undefined) ?? [];
                      if (!current.includes(clinicianId)) {
                        form.setValue(field as never, [...current, clinicianId] as never, {
                          shouldDirty: true,
                        });
                      }
                    }}
                    onRemove={(clinicianId) => {
                      const isTherapist = props.therapists.some((c) => c.id === clinicianId);
                      const field = isTherapist ? 'therapistIds' : 'doctorIds';
                      const current =
                        (form.getValues(field as never) as unknown as string[] | undefined) ?? [];
                      form.setValue(
                        field as never,
                        current.filter((id) => id !== clinicianId) as never,
                        { shouldDirty: true },
                      );
                    }}
                  />
                </CardContent>
              </Card>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button asChild variant="outline" type="button">
                <Link href="/secretary/patients">{tCommon('cancel')}</Link>
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('submit')}
              </Button>
            </div>
          </div>
        );
      }}
    </AppForm>
  );
}
