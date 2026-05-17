'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { z } from 'zod';

import { AppForm } from '@/components/forms/AppForm';
import { SwitchField, TextField } from '@/components/forms/FormFields';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { createRoomAction, updateRoomAction } from '@/lib/admin/rooms/actions';
import { roomCreateSchema, roomUpdateSchema } from '@/lib/admin/rooms/schemas';

interface Props {
  mode: 'create' | 'edit';
  initial?: { id: string; name: string; active: boolean };
}

export function RoomForm({ mode, initial }: Props) {
  const t = useTranslations('admin.rooms');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const isEdit = mode === 'edit';

  const schema = isEdit ? roomUpdateSchema : roomCreateSchema;
  const defaultValues = isEdit
    ? { id: initial!.id, name: initial!.name, active: initial!.active }
    : { name: '', active: true };

  const action = (values: z.infer<typeof roomCreateSchema | typeof roomUpdateSchema>) =>
    isEdit
      ? updateRoomAction(values as z.infer<typeof roomUpdateSchema>)
      : createRoomAction(values as z.infer<typeof roomCreateSchema>);

  return (
    <AppForm
      schema={schema}
      defaultValues={defaultValues as never}
      action={action as never}
      successToast={isEdit ? t('updatedToast') : t('createdToast')}
      onSuccess={() => router.push(`/${locale}/admin/rooms`)}
    >
      {(form) => (
        <div className="max-w-md space-y-4">
          <TextField form={form} name={'name' as never} label={t('name')} />
          <SwitchField form={form} name={'active' as never} label={t('active')} />
          <div className="flex items-center justify-end gap-2">
            <Button asChild variant="outline" type="button">
              <Link href="/admin/rooms">{tCommon('cancel')}</Link>
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
