'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { z } from 'zod';

import { AppForm } from '@/components/forms/AppForm';
import { SwitchField, TextField, TextareaField } from '@/components/forms/FormFields';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { createSpecialtyAction, updateSpecialtyAction } from '@/lib/admin/specialties/actions';
import { specialtyCreateSchema, specialtyUpdateSchema } from '@/lib/admin/specialties/schemas';

interface Props {
  mode: 'create' | 'edit';
  initial?: {
    id: string;
    nameEn: string;
    nameAr: string;
    description: string | null;
    active: boolean;
  };
}

export function SpecialtyForm({ mode, initial }: Props) {
  const t = useTranslations('admin.specialties');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const isEdit = mode === 'edit';

  const schema = isEdit ? specialtyUpdateSchema : specialtyCreateSchema;
  const defaultValues = isEdit
    ? {
        id: initial!.id,
        nameEn: initial!.nameEn,
        nameAr: initial!.nameAr,
        description: initial!.description ?? '',
        active: initial!.active,
      }
    : { nameEn: '', nameAr: '', description: '', active: true };

  const action = (values: z.infer<typeof specialtyCreateSchema | typeof specialtyUpdateSchema>) =>
    isEdit
      ? updateSpecialtyAction(values as z.infer<typeof specialtyUpdateSchema>)
      : createSpecialtyAction(values as z.infer<typeof specialtyCreateSchema>);

  return (
    <AppForm
      schema={schema}
      defaultValues={defaultValues as never}
      action={action as never}
      successToast={isEdit ? t('updatedToast') : t('createdToast')}
      onSuccess={() => router.push(`/${locale}/admin/specialties`)}
    >
      {(form) => (
        <div className="max-w-xl space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name={'nameEn' as never} label={t('nameEn')} />
            <TextField form={form} name={'nameAr' as never} label={t('nameAr')} />
          </div>
          <TextareaField
            form={form}
            name={'description' as never}
            label={t('description')}
            rows={3}
          />
          <SwitchField form={form} name={'active' as never} label={t('active')} />
          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="outline" type="button">
              <Link href="/admin/specialties">{tCommon('cancel')}</Link>
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
