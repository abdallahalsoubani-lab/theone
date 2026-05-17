'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';

/**
 * Locale-scoped error boundary.
 *
 * Must be a Client Component per Next.js App Router. Sentry integration is
 * deferred — for now we log to the console so the failure is visible in dev
 * tools and server logs while still showing a localized recovery UI to the
 * user. Prompt 11 (hardening) wires Sentry into the `useEffect` below.
 */
export default function LocaleErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors.generic');

  useEffect(() => {
    console.error('[locale-error-boundary]', error);
  }, [error]);

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-6 px-6 py-24 text-center">
      <Logo size={64} />
      <div className="space-y-3">
        <h1 className="text-3xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="text-brand-textMuted">{t('description')}</p>
        {error.digest ? (
          <p className="text-xs text-brand-textMuted">
            {t('digest')}: <code>{error.digest}</code>
          </p>
        ) : null}
      </div>
      <Button onClick={reset} className="bg-gradient-cta text-white hover:opacity-90">
        {t('cta')}
      </Button>
    </section>
  );
}
