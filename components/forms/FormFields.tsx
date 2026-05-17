'use client';

import { useId } from 'react';
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

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

/**
 * Typed single-line text/email/number/phone/tel/password input.
 *
 * Used like:
 *   <TextField form={form} name="email" label={t('emailLabel')} type="email" />
 *
 * Wraps `<FormField>` so error display and aria-* wiring are handled by the
 * shared form primitives.
 */
interface TextFieldProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'number' | 'password' | 'url';
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'tel' | 'numeric' | 'decimal' | 'url';
  disabled?: boolean;
  className?: string;
}

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  placeholder,
  type = 'text',
  autoComplete,
  inputMode,
  disabled,
  className,
}: TextFieldProps<T>) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              type={type}
              placeholder={placeholder}
              autoComplete={autoComplete}
              inputMode={inputMode}
              disabled={disabled}
              value={field.value ?? ''}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

interface TextareaFieldProps<T extends FieldValues> extends Omit<
  TextFieldProps<T>,
  'type' | 'inputMode' | 'autoComplete'
> {
  rows?: number;
}

export function TextareaField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  placeholder,
  rows = 4,
  disabled,
  className,
}: TextareaFieldProps<T>) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <textarea
              {...field}
              rows={rows}
              placeholder={placeholder}
              disabled={disabled}
              value={field.value ?? ''}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

interface SelectFieldProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  className?: string;
}

export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  options,
  disabled,
  className,
}: SelectFieldProps<T>) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <select
              {...field}
              disabled={disabled}
              value={field.value ?? ''}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

interface SwitchFieldProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function SwitchField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  disabled,
  className,
}: SwitchFieldProps<T>) {
  const checkboxId = useId();
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem
          className={`flex flex-row items-start gap-3 space-y-0 rounded-md border border-brand-border p-3 ${className ?? ''}`}
        >
          <FormControl>
            <input
              id={checkboxId}
              type="checkbox"
              checked={Boolean(field.value)}
              onChange={(e) => field.onChange(e.target.checked)}
              onBlur={field.onBlur}
              disabled={disabled}
              className="mt-1 size-4 cursor-pointer accent-brand-cyan"
            />
          </FormControl>
          <div className="flex-1 space-y-1">
            <Label htmlFor={checkboxId} className="cursor-pointer">
              {label}
            </Label>
            {description ? <p className="text-xs text-brand-textMuted">{description}</p> : null}
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  );
}

interface MultiSelectFieldProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  className?: string;
}

export function MultiSelectField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  options,
  disabled,
  className,
}: MultiSelectFieldProps<T>) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const selected = new Set<string>(((field.value ?? []) as string[]) ?? []);
        const toggle = (value: string) => {
          const next = new Set(selected);
          if (next.has(value)) next.delete(value);
          else next.add(value);
          field.onChange(Array.from(next));
        };
        return (
          <FormItem className={className}>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <div className="flex flex-wrap gap-2 rounded-md border border-input bg-background p-2">
                {options.map((o) => {
                  const on = selected.has(o.value);
                  return (
                    <button
                      type="button"
                      key={o.value}
                      onClick={() => toggle(o.value)}
                      disabled={disabled}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        on
                          ? 'bg-brand-navy text-white'
                          : 'bg-brand-bg text-brand-textMuted hover:bg-brand-border'
                      }`}
                      aria-pressed={on}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </FormControl>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
