'use client';

import { useLocale } from 'next-intl';
import { Toaster as SonnerToaster } from 'sonner';

/**
 * Project-wide toast surface. Mounted once in the locale layout; callers fire
 * toasts via the `toast.*` API from `sonner` directly.
 *
 * RTL alignment: under `ar` we anchor to the inline-start corner so the toast
 * stack appears on the right of the screen for Arabic users, matching the
 * usual `start` semantics across the rest of the UI.
 */
export function Toaster() {
  const locale = useLocale();
  return (
    <SonnerToaster
      position={locale === 'ar' ? 'top-left' : 'top-right'}
      richColors
      closeButton
      toastOptions={{
        className: 'font-sans rtl:font-arabic',
      }}
    />
  );
}
