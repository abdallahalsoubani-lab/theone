'use client';

import { CustomQuestionType } from '@prisma/client';
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

import { TextField, TextareaField } from '@/components/forms/FormFields';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { CustomQuestionRow } from '@/lib/admin/custom-questions/queries';

interface Props<T extends FieldValues> {
  form: UseFormReturn<T>;
  question: CustomQuestionRow;
  locale: 'en' | 'ar';
  /** RHF field name under which the answer is stored. Typically `customAnswers.${question.id}`. */
  name: FieldPath<T>;
}

/**
 * Single component that renders any of the six CustomQuestionType inputs.
 * Used inside both the Adult and Pediatric intake forms (and any future
 * intake-shaped flow).
 */
export function CustomQuestionField<T extends FieldValues>({
  form,
  question,
  locale,
  name,
}: Props<T>) {
  const label = locale === 'ar' ? question.nameAr : question.nameEn;
  const fullLabel = question.required ? `${label} *` : label;

  if (question.type === CustomQuestionType.TEXT) {
    return <TextField form={form} name={name} label={fullLabel} />;
  }
  if (question.type === CustomQuestionType.TEXTAREA) {
    return <TextareaField form={form} name={name} label={fullLabel} rows={3} />;
  }
  if (question.type === CustomQuestionType.NUMBER) {
    return (
      <TextField form={form} name={name} label={fullLabel} type="number" inputMode="numeric" />
    );
  }
  if (question.type === CustomQuestionType.DATE) {
    return (
      <TextField form={form} name={name} label={fullLabel} type="text" placeholder="YYYY-MM-DD" />
    );
  }

  // SINGLE_SELECT / MULTI_SELECT
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const isMulti = question.type === CustomQuestionType.MULTI_SELECT;
        const current = (field.value ?? (isMulti ? [] : '')) as string | string[];
        const isSelected = (value: string) =>
          isMulti ? (current as string[]).includes(value) : current === value;
        const onToggle = (value: string) => {
          if (isMulti) {
            const next = new Set(current as string[]);
            if (next.has(value)) next.delete(value);
            else next.add(value);
            field.onChange(Array.from(next));
          } else {
            field.onChange(value);
          }
        };
        return (
          <FormItem>
            <FormLabel>{fullLabel}</FormLabel>
            <FormControl>
              <div className="space-y-1.5 rounded-md border border-input bg-background p-3">
                {question.options.map((o) => {
                  const v = locale === 'ar' ? o.valueAr : o.valueEn;
                  const inputId = `q-${question.id}-${o.value}`;
                  return (
                    <Label
                      key={o.value}
                      htmlFor={inputId}
                      className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                    >
                      <Input
                        id={inputId}
                        type={isMulti ? 'checkbox' : 'radio'}
                        name={String(name)}
                        checked={isSelected(o.value)}
                        onChange={() => onToggle(o.value)}
                        className="size-4 cursor-pointer accent-brand-cyan"
                      />
                      <span>{v}</span>
                    </Label>
                  );
                })}
              </div>
            </FormControl>
            <FormDescription className="sr-only">{label}</FormDescription>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
