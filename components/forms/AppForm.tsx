'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale } from 'next-intl';
import type { ReactNode } from 'react';
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type SubmitHandler,
  type UseFormReturn,
} from 'react-hook-form';
import { toast } from 'sonner';
import type { ZodTypeAny, z } from 'zod';

import { Form } from '@/components/ui/form';
import type { Result } from '@/lib/auth/result';
import { cn } from '@/lib/utils';

/**
 * Project-wide form pattern: react-hook-form + Zod + shadcn Form, wired to a
 * server action that returns the Result<T, E> shape from Prompt 4.
 *
 * The submit handler:
 *   1. Parses with Zod (resolver) before reaching the action
 *   2. Calls the action; on ok, shows `successToast` and runs `onSuccess`
 *   3. On fail, shows `error.message_{en|ar}` as a toast.error and surfaces
 *      `error.details` as field-level setError() calls when the shape matches
 *
 * Future feature prompts reuse this verbatim — no per-form submit boilerplate.
 */
export interface AppFormProps<TSchema extends ZodTypeAny, TResult> {
  schema: TSchema;
  defaultValues: DefaultValues<z.infer<TSchema>>;
  action: (values: z.infer<TSchema>) => Promise<Result<TResult>>;
  successToast: string;
  onSuccess?: (data: TResult, form: UseFormReturn<z.infer<TSchema>>) => void;
  resetOnSuccess?: boolean;
  className?: string;
  children: (form: UseFormReturn<z.infer<TSchema>>) => ReactNode;
}

export function AppForm<TSchema extends ZodTypeAny, TResult>({
  schema,
  defaultValues,
  action,
  successToast,
  onSuccess,
  resetOnSuccess = false,
  className,
  children,
}: AppFormProps<TSchema, TResult>) {
  const locale = useLocale();
  const form = useForm<z.infer<TSchema>>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onBlur',
  });

  const onSubmit: SubmitHandler<z.infer<TSchema>> = async (values) => {
    const result = await action(values);
    if (!result.ok) {
      const message = locale === 'ar' ? result.error.message_ar : result.error.message_en;
      toast.error(message);
      const details = result.error.details as Record<string, string> | undefined;
      if (details && typeof details === 'object') {
        for (const [path, msg] of Object.entries(details)) {
          if (typeof msg === 'string') {
            form.setError(path as never, { message: msg });
          }
        }
      }
      return;
    }
    toast.success(successToast);
    if (resetOnSuccess) form.reset(defaultValues);
    onSuccess?.(result.data, form);
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('space-y-6', className)}
        noValidate
      >
        {children(form)}
      </form>
    </Form>
  );
}

// Re-export for ergonomics so callers import from a single place.
export type { FieldValues };
