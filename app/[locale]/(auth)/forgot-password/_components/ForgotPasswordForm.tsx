'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestPasswordReset } from '@/lib/auth/actions/password';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <p className="rounded-md bg-brand-bg px-3 py-3 text-center text-sm text-brand-navy">
        {t('forgotPasswordSent')}
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const identifier = String(new FormData(e.currentTarget).get('identifier') ?? '');
        startTransition(async () => {
          await requestPasswordReset({ identifier });
          setSent(true);
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="identifier">{t('identifierLabel')}</Label>
        <Input id="identifier" name="identifier" type="text" required autoComplete="email" />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('signingIn') : t('submit')}
      </Button>
    </form>
  );
}
