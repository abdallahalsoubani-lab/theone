'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPassword } from '@/lib/auth/actions/password';

import { errorMessageKey } from '../../login/_components/errorMessage';

export function ResetPasswordForm({ token }: { token: string }) {
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
        const newPassword = String(form.get('newPassword') ?? '');
        const confirm = String(form.get('confirm') ?? '');
        setError(null);
        if (newPassword !== confirm) {
          setError('passwordsMustMatch');
          return;
        }
        startTransition(async () => {
          const result = await resetPassword({ token, newPassword });
          if (!result.ok) {
            setError(errorMessageKey(result.error.code));
            return;
          }
          router.replace(`/${locale}/login`);
          router.refresh();
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="newPassword">{t('newPasswordLabel')}</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t('confirmPasswordLabel')}</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending || !token}>
        {pending ? t('signingIn') : t('submit')}
      </Button>
    </form>
  );
}
