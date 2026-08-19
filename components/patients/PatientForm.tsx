'use client';

import { Gender, LanguagePref } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';

import { clinicDateKey } from '@/lib/time/clinic';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { z } from 'zod';

import { AppForm } from '@/components/forms/AppForm';
import { SelectField, SwitchField, TextField, TextareaField } from '@/components/forms/FormFields';
import { DateField } from '@/components/forms/DateField';
import { CareTeamEditor } from '@/components/patients/CareTeamEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { Link } from '@/i18n/navigation';
import type { Result } from '@/lib/auth/result';
import { createPatientAction, updatePatientAction } from '@/lib/patients/actions';
import type { ClinicianRef } from '@/lib/patients/assignment';
import {
  patientCreateSchema,
  patientUpdateSchema,
  type PatientCreateInput,
  type PatientUpdateInput,
} from '@/lib/patients/schemas';

interface CreateProps {
  mode: 'create';
  /** Full clinician option lists for the care-team multi-select. */
  therapists: ClinicianRef[];
  doctors: ClinicianRef[];
}

interface EditProps {
  mode: 'edit';
  // P50 (revised): the update shape — gender may be null on imported/legacy
  // records; the create schema keeps it required.
  initial: PatientUpdateInput;
}

/** The viewer's patients segment (A-19: post-save redirects + cancel stay in
 *  the viewer's own shell). Defaults to the Secretary flow. */
type Props = (CreateProps | EditProps) & {
  basePath?: '/secretary/patients' | '/admin/patients';
};

export function PatientForm(props: Props) {
  const basePath = props.basePath ?? '/secretary/patients';
  const t = useTranslations('patients.form');
  const tCommon = useTranslations('common');
  const tPatients = useTranslations('patients.toasts');
  const router = useRouter();
  const locale = useLocale();

  const isEdit = props.mode === 'edit';
  const schema = isEdit ? patientUpdateSchema : patientCreateSchema;
  // DOB renders as a date-only input (no wall-time strings — rule #1):
  // the value is a clinic-tz date key; z.coerce.date() re-parses on submit.
  const toDateInputValue = (d: Date | string): Date =>
    clinicDateKey(d instanceof Date ? d : new Date(d)) as unknown as Date;

  const defaults: PatientCreateInput | PatientUpdateInput = isEdit
    ? { ...props.initial, dateOfBirth: toDateInputValue(props.initial.dateOfBirth) }
    : {
        fullNameEn: '',
        phone: '+9627',
        email: null,
        dateOfBirth: toDateInputValue(new Date()),
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
        confirmSharedPhone: false,
      };
  const defaultValues = isEdit ? { id: props.initial.id, ...defaults } : defaults;

  // P50 §5.3 — shared-phone confirm flow. The first create attempt against a
  // number already registered to another patient fails with
  // PATIENT_PHONE_SHARED_CONFIRM; we hold the submit promise open, ask, and on
  // confirm resubmit with the flag. Cancel resolves with a client-side marker
  // the onError hook below swallows (the dialog already communicated it).
  type CreateResult = Awaited<ReturnType<typeof createPatientAction>>;
  const [sharedPrompt, setSharedPrompt] = useState<{
    message: string;
    values: z.infer<typeof patientCreateSchema>;
    resolve: (r: CreateResult) => void;
  } | null>(null);

  const action = async (
    values: z.infer<typeof patientCreateSchema | typeof patientUpdateSchema>,
  ) => {
    if (isEdit) return updatePatientAction(values as z.infer<typeof patientUpdateSchema>);
    const createValues = values as z.infer<typeof patientCreateSchema>;
    const first = await createPatientAction(createValues);
    if (!first.ok && first.error.code === 'PATIENT_PHONE_SHARED_CONFIRM') {
      const message = locale === 'ar' ? first.error.message_ar : first.error.message_en;
      return new Promise<CreateResult>((resolve) =>
        setSharedPrompt({ message, values: createValues, resolve }),
      );
    }
    return first;
  };

  const confirmSharedPhone = async () => {
    const prompt = sharedPrompt;
    if (!prompt) return;
    setSharedPrompt(null);
    prompt.resolve(await createPatientAction({ ...prompt.values, confirmSharedPhone: true }));
  };

  const cancelSharedPhone = () => {
    const prompt = sharedPrompt;
    if (!prompt) return;
    setSharedPrompt(null);
    const cancelled: CreateResult = {
      ok: false,
      error: { code: 'PATIENT_PHONE_SHARED_CANCELLED', message_en: '', message_ar: '' },
    } as Result<never> as CreateResult;
    prompt.resolve(cancelled);
  };

  return (
    <AppForm
      schema={schema}
      defaultValues={defaultValues as never}
      action={action as never}
      onError={(error) => error.code === 'PATIENT_PHONE_SHARED_CANCELLED'}
      successToast={isEdit ? tPatients('updated') : tPatients('created')}
      onSuccess={(data) => {
        if (isEdit) {
          router.push(`/${locale}${basePath}/${(data as { patientId: string }).patientId}`);
          return;
        }
        const d = data as {
          patientId: string;
          tempPassword: string;
          whatsappStatus: 'SENT' | 'FAILED';
        };
        const url = new URL(`/${locale}${basePath}/${d.patientId}/created`, window.location.origin);
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
                {/* P47 row 8 — the Arabic-name field is gone; English is
                    the only name. The DB column stays untouched. */}
                <TextField form={form} name={'fullNameEn' as never} label={t('fullNameEn')} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <DateField form={form} name={'dateOfBirth' as never} label={t('dateOfBirth')} />
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
                <Link href={basePath}>{tCommon('cancel')}</Link>
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('submit')}
              </Button>
            </div>

            {/* P50 §5.3 — duplicate-phone warning: confirm, never block. */}
            <ResponsiveModal
              open={sharedPrompt !== null}
              onOpenChange={(open) => {
                if (!open) cancelSharedPhone();
              }}
            >
              <ResponsiveModalContent>
                <ResponsiveModalHeader>
                  <ResponsiveModalTitle>{t('sharedPhoneTitle')}</ResponsiveModalTitle>
                  <ResponsiveModalDescription>{sharedPrompt?.message}</ResponsiveModalDescription>
                </ResponsiveModalHeader>
                <ResponsiveModalFooter>
                  <Button type="button" variant="outline" onClick={cancelSharedPhone}>
                    {tCommon('cancel')}
                  </Button>
                  <Button type="button" onClick={confirmSharedPhone}>
                    {tCommon('confirm')}
                  </Button>
                </ResponsiveModalFooter>
              </ResponsiveModalContent>
            </ResponsiveModal>
          </div>
        );
      }}
    </AppForm>
  );
}
