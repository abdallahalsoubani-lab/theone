'use client';

import { LanguagePref, UserRole } from '@prisma/client';
import { Copy } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import type { z } from 'zod';

import { AppForm } from '@/components/forms/AppForm';
import {
  MultiSelectField,
  SelectField,
  SwitchField,
  TextField,
} from '@/components/forms/FormFields';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { createUserAction, updateUserAction } from '@/lib/admin/users/actions';
import { STAFF_ROLES, userCreateSchema, userUpdateSchema } from '@/lib/admin/users/schemas';

interface SpecialtyOption {
  id: string;
  nameEn: string;
  nameAr: string;
}

interface Props {
  mode: 'create' | 'edit';
  specialties: SpecialtyOption[];
  initial?: {
    id: string;
    fullNameEn: string;
    fullNameAr: string;
    email: string;
    phone: string;
    role: UserRole;
    languagePref: LanguagePref;
    specialtyIds: string[];
    mustChangePassword: boolean;
  };
}

const CLINICAL_ROLES = new Set<UserRole>([UserRole.DOCTOR, UserRole.THERAPIST]);

export function UserForm({ mode, specialties, initial }: Props) {
  const t = useTranslations('admin.users');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const isEdit = mode === 'edit';
  const schema = isEdit ? userUpdateSchema : userCreateSchema;
  // The form needs a stable defaultValues object.
  const defaults = initial ?? {
    fullNameEn: '',
    fullNameAr: '',
    email: '',
    phone: '+9627',
    role: UserRole.SECRETARY,
    languagePref: LanguagePref.AR,
    specialtyIds: [],
    mustChangePassword: true,
  };
  const defaultValues = isEdit ? { id: initial!.id, ...defaults } : defaults;

  const action = (values: z.infer<typeof userCreateSchema | typeof userUpdateSchema>) =>
    isEdit
      ? updateUserAction(values as z.infer<typeof userUpdateSchema>)
      : createUserAction(values as z.infer<typeof userCreateSchema>);

  if (tempPassword) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-6">
          <h2 className="text-lg font-medium text-brand-navy">{t('tempPasswordTitle')}</h2>
          <p className="text-sm text-brand-textMuted">{t('tempPasswordDescription')}</p>
          <div className="flex items-center justify-between gap-2 rounded-md border border-brand-border bg-brand-bg px-3 py-2">
            <code className="font-mono text-base text-brand-navy">{tempPassword}</code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(tempPassword);
                toast.success(t('copied'));
              }}
            >
              <Copy className="me-1 size-4" />
              {t('copyPassword')}
            </Button>
          </div>
          <Button asChild className="w-full">
            <Link href="/admin/users">{tCommon('back')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const roleOptions = STAFF_ROLES.map((r) => ({ value: r, label: t(`role${capitalize(r)}`) }));
  const languageOptions = [
    { value: LanguagePref.AR, label: 'العربية' },
    { value: LanguagePref.EN, label: 'English' },
  ];
  const specialtyOptions = specialties.map((s) => ({
    value: s.id,
    label: locale === 'ar' ? s.nameAr : s.nameEn,
  }));

  return (
    <AppForm
      schema={schema}
      defaultValues={defaultValues as never}
      action={action as never}
      successToast={isEdit ? t('updatedToast') : t('createdToast')}
      onSuccess={(data) => {
        const result = data as { userId: string; tempPassword?: string };
        if (!isEdit && result.tempPassword) {
          setTempPassword(result.tempPassword);
        } else {
          router.push(`/${locale}/admin/users`);
        }
      }}
    >
      {(form) => {
        const role = form.watch('role' as never) as unknown as UserRole;
        const showSpecialties = CLINICAL_ROLES.has(role);
        return (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField form={form} name={'fullNameEn' as never} label={t('fullNameEn')} />
              <TextField form={form} name={'fullNameAr' as never} label={t('fullNameAr')} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                form={form}
                name={'email' as never}
                label={t('fullNameEn')}
                type="email"
                autoComplete="email"
              />
              <TextField
                form={form}
                name={'phone' as never}
                label={t('fullNameEn')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+9627XXXXXXXX"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                form={form}
                name={'role' as never}
                label={t('role')}
                options={roleOptions}
              />
              <SelectField
                form={form}
                name={'languagePref' as never}
                label={tCommon('languageToggle')}
                options={languageOptions}
              />
            </div>
            {showSpecialties ? (
              <MultiSelectField
                form={form}
                name={'specialtyIds' as never}
                label={t('specialties')}
                options={specialtyOptions}
              />
            ) : null}
            <SwitchField
              form={form}
              name={'mustChangePassword' as never}
              label={t('mustChangePassword')}
            />
            <div className="flex items-center justify-end gap-2">
              <Button asChild variant="outline" type="button">
                <Link href="/admin/users">{tCommon('cancel')}</Link>
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

function capitalize<T extends string>(s: T): Capitalize<Lowercase<T>> {
  const lower = s.toLowerCase();
  return (lower[0]!.toUpperCase() + lower.slice(1)) as Capitalize<Lowercase<T>>;
}
