'use client';

import { CustomQuestionAppliesTo, CustomQuestionType } from '@prisma/client';
import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { z } from 'zod';

import { AppForm } from '@/components/forms/AppForm';
import { SelectField, SwitchField, TextField } from '@/components/forms/FormFields';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/navigation';
import {
  createCustomQuestionAction,
  updateCustomQuestionAction,
} from '@/lib/admin/custom-questions/actions';
import {
  customQuestionCreateSchema,
  customQuestionUpdateSchema,
  isSelectType,
  type CustomQuestionOption,
} from '@/lib/admin/custom-questions/schemas';

interface Props {
  mode: 'create' | 'edit';
  initial?: {
    id: string;
    nameEn: string;
    nameAr: string;
    type: CustomQuestionType;
    appliesTo: CustomQuestionAppliesTo;
    required: boolean;
    active: boolean;
    options: CustomQuestionOption[];
  };
}

function randomKey(): string {
  return `opt-${Math.random().toString(36).slice(2, 10)}`;
}

export function QuestionForm({ mode, initial }: Props) {
  const t = useTranslations('admin.customQuestions');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const isEdit = mode === 'edit';

  const schema = isEdit ? customQuestionUpdateSchema : customQuestionCreateSchema;
  const defaultValues = isEdit
    ? {
        id: initial!.id,
        nameEn: initial!.nameEn,
        nameAr: initial!.nameAr,
        type: initial!.type,
        appliesTo: initial!.appliesTo,
        required: initial!.required,
        active: initial!.active,
        options: initial!.options,
      }
    : {
        nameEn: '',
        nameAr: '',
        type: CustomQuestionType.TEXT,
        appliesTo: CustomQuestionAppliesTo.ADULT,
        required: false,
        active: true,
        options: [] as CustomQuestionOption[],
      };

  const action = (values: z.infer<typeof schema>) =>
    isEdit
      ? updateCustomQuestionAction(values as z.infer<typeof customQuestionUpdateSchema>)
      : createCustomQuestionAction(values as z.infer<typeof customQuestionCreateSchema>);

  const typeOptions = (Object.values(CustomQuestionType) as CustomQuestionType[]).map((v) => ({
    value: v,
    label: t(`type${pascal(v)}`),
  }));
  const appliesOptions = (Object.values(CustomQuestionAppliesTo) as CustomQuestionAppliesTo[]).map(
    (v) => ({ value: v, label: t(`applies${pascal(v)}`) }),
  );

  return (
    <AppForm
      schema={schema}
      defaultValues={defaultValues as never}
      action={action as never}
      successToast={isEdit ? t('updatedToast') : t('createdToast')}
      onSuccess={() => router.push(`/${locale}/admin/intake-questions`)}
    >
      {(form) => {
        const type = form.watch('type' as never) as unknown as CustomQuestionType;
        const options = (form.watch('options' as never) ?? []) as CustomQuestionOption[];
        const nameEn = String(form.watch('nameEn' as never) ?? '');
        const nameAr = String(form.watch('nameAr' as never) ?? '');
        const required = Boolean(form.watch('required' as never));

        const addOption = () => {
          form.setValue(
            'options' as never,
            [...options, { value: randomKey(), valueEn: '', valueAr: '' }] as never,
            { shouldDirty: true },
          );
        };
        const removeOption = (idx: number) => {
          const next = options.filter((_, i) => i !== idx);
          form.setValue('options' as never, next as never, { shouldDirty: true });
        };
        const editOption = (idx: number, patch: Partial<CustomQuestionOption>) => {
          const next = options.map((o, i) => (i === idx ? { ...o, ...patch } : o));
          form.setValue('options' as never, next as never, { shouldDirty: true });
        };

        return (
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField form={form} name={'nameEn' as never} label={t('nameEn')} />
                <TextField form={form} name={'nameAr' as never} label={t('nameAr')} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  form={form}
                  name={'type' as never}
                  label={t('type')}
                  options={typeOptions}
                />
                <SelectField
                  form={form}
                  name={'appliesTo' as never}
                  label={t('appliesTo')}
                  options={appliesOptions}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SwitchField form={form} name={'required' as never} label={t('required')} />
                <SwitchField form={form} name={'active' as never} label={tCommon('yes')} />
              </div>

              {isSelectType(type) ? (
                <div className="space-y-2 rounded-md border border-brand-border bg-brand-surface p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-brand-navy">{t('options')}</h3>
                    <Button type="button" size="sm" variant="outline" onClick={addOption}>
                      <Plus className="me-1 size-4" />
                      {t('addOption')}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {options.length === 0 ? (
                      <p className="text-xs text-brand-textMuted">{t('addOption')}</p>
                    ) : null}
                    {options.map((opt, idx) => (
                      <div
                        key={opt.value}
                        className="grid grid-cols-[1fr_1fr_auto] items-center gap-2"
                      >
                        <div className="space-y-1">
                          <Label
                            htmlFor={`opt-en-${opt.value}`}
                            className="text-xs text-brand-textMuted"
                          >
                            {t('optionValueEn')}
                          </Label>
                          <Input
                            id={`opt-en-${opt.value}`}
                            value={opt.valueEn}
                            onChange={(e) => editOption(idx, { valueEn: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label
                            htmlFor={`opt-ar-${opt.value}`}
                            className="text-xs text-brand-textMuted"
                          >
                            {t('optionValueAr')}
                          </Label>
                          <Input
                            id={`opt-ar-${opt.value}`}
                            value={opt.valueAr}
                            onChange={(e) => editOption(idx, { valueAr: e.target.value })}
                          />
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => removeOption(idx)}
                          aria-label="remove"
                          className="mt-5"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2">
                <Button asChild variant="outline" type="button">
                  <Link href="/admin/intake-questions">{tCommon('cancel')}</Link>
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {tCommon('save')}
                </Button>
              </div>
            </div>

            <Card>
              <CardContent className="space-y-3 p-4">
                <p className="text-xs font-medium uppercase tracking-wider text-brand-textMuted">
                  {t('preview')}
                </p>
                <Preview
                  locale={locale}
                  type={type}
                  nameEn={nameEn}
                  nameAr={nameAr}
                  required={required}
                  options={options}
                />
              </CardContent>
            </Card>
          </div>
        );
      }}
    </AppForm>
  );
}

function Preview({
  locale,
  type,
  nameEn,
  nameAr,
  required,
  options,
}: {
  locale: string;
  type: CustomQuestionType;
  nameEn: string;
  nameAr: string;
  required: boolean;
  options: CustomQuestionOption[];
}) {
  const name = locale === 'ar' ? nameAr : nameEn;
  const id = 'preview-field';
  return (
    <div className="space-y-2" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <Label htmlFor={id} className="font-medium text-brand-navy">
        {name || '—'} {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {type === 'TEXT' ? <Input id={id} disabled /> : null}
      {type === 'TEXTAREA' ? (
        <textarea
          id={id}
          disabled
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      ) : null}
      {type === 'NUMBER' ? <Input id={id} type="number" disabled /> : null}
      {type === 'DATE' ? <Input id={id} type="date" disabled /> : null}
      {type === 'SINGLE_SELECT' ? (
        <div className="space-y-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="radio" disabled name="prev" />
              <span>{locale === 'ar' ? o.valueAr : o.valueEn || '—'}</span>
            </label>
          ))}
        </div>
      ) : null}
      {type === 'MULTI_SELECT' ? (
        <div className="space-y-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled />
              <span>{locale === 'ar' ? o.valueAr : o.valueEn || '—'}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function pascal<T extends string>(s: T): string {
  return s
    .toLowerCase()
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}
