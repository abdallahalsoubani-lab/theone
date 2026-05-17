'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginWithCredentials } from '@/lib/auth/actions/login';

import { errorMessageKey } from './errorMessage';

export function StaffLoginForm() {
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
        const email = String(form.get('email') ?? '');
        const password = String(form.get('password') ?? '');
        setError(null);
        startTransition(async () => {
          const result = await loginWithCredentials({ email, password });
          if (!result.ok) {
            setError(errorMessageKey(result.error.code));
            return;
          }
          router.replace(`/${locale}${result.data.redirectTo}`);
          router.refresh();
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="staff-email">{t('emailLabel')}</Label>
        <Input id="staff-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="staff-password">{t('passwordLabel')}</Label>
        <Input
          id="staff-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('signingIn') : t('signIn')}
      </Button>
    </form>
  );
}
