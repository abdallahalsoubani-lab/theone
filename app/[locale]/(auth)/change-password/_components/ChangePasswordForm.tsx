'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changePasswordAction } from '@/lib/auth/actions/password';

import { errorMessageKey } from '../../login/_components/errorMessage';

export function ChangePasswordForm({
  successHref,
  forced,
}: {
  successHref: string;
  forced: boolean;
}) {
  const t = useTranslations('auth');
  const router = useRouter();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const currentPassword = String(form.get('currentPassword') ?? '');
        const newPassword = String(form.get('newPassword') ?? '');
        const confirm = String(form.get('confirm') ?? '');
        setError(null);
        if (newPassword !== confirm) {
          setError('passwordsMustMatch');
          return;
        }
        startTransition(async () => {
          const result = await changePasswordAction({ currentPassword, newPassword });
          if (!result.ok) {
            setError(errorMessageKey(result.error.code));
            return;
          }
          router.replace(`/${locale}${successHref}`);
          router.refresh();
        });
      }}
    >
      {forced ? (
        <p className="rounded-md bg-brand-bg px-3 py-2 text-sm text-brand-navy">
          {t('mustChangePassword')}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="currentPassword">{t('currentPasswordLabel')}</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="newPassword">{t('newPasswordLabel')}</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t('confirmPasswordLabel')}</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('signingIn') : t('submit')}
      </Button>
    </form>
  );
}
