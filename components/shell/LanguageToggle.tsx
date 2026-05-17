'use client';

import { Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { routing } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Single-button language toggle.
 *
 * Behaviour (Prompt 3 §4.7):
 *   - Label shows the *other* locale's name (on /en it reads "العربية"; on /ar it reads "English")
 *   - Click sets the NEXT_LOCALE cookie (1-year expiry, SameSite=Lax, Path=/)
 *   - Click swaps the first path segment and preserves query string and hash
 *   - Uses next/navigation router, not a full page reload
 *
 * When auth lands in Prompt 4 we'll mirror this preference into the User
 * row's `languagePref` column for authenticated users (cookie still drives
 * the unauthenticated case).
 */
export function LanguageToggle({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();
  const t = useTranslations('common');
  const [isPending, startTransition] = useTransition();

  const otherLocale = routing.locales.find((l) => l !== currentLocale) ?? routing.defaultLocale;

  const switchTo = (target: string) => {
    const segments = pathname.split('/');
    if (segments[1] && (routing.locales as readonly string[]).includes(segments[1])) {
      segments[1] = target;
    } else {
      segments.splice(1, 0, target);
    }
    const newPath = segments.join('/') || `/${target}`;
    // Read the live query string + hash from the URL (we're already client-side).
    // useSearchParams would force this whole tree into dynamic rendering.
    const suffix =
      typeof window === 'undefined' ? '' : window.location.search + window.location.hash;
    const url = `${newPath}${suffix}`;

    document.cookie = `NEXT_LOCALE=${target}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    startTransition(() => {
      router.replace(url);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => switchTo(otherLocale)}
        disabled={isPending}
        aria-label={t('languageToggleAriaLabel')}
        className={cn('gap-2', className)}
      >
        <Globe className="size-4" aria-hidden />
        <span>{t('languageToggle')}</span>
      </Button>
      <span aria-live="polite" className="sr-only">
        {isPending ? t('loading') : ''}
      </span>
    </>
  );
}
