import { getTranslations } from 'next-intl/server';

import { Logo } from '@/components/brand/Logo';
import { Link } from '@/i18n/navigation';

/**
 * Site header — Prompt 3 lands the structural shell.
 * The interactive parts (language toggle, mobile nav drawer, user menu)
 * are added in commit 2 of this prompt.
 */
export async function Header() {
  const t = await getTranslations();

  return (
    <header
      className="sticky top-0 z-40 flex h-16 items-center border-b border-brand-border bg-brand-surface px-4 sm:px-6"
      aria-label={t('shell.headerLandmark')}
    >
      <Link href="/" className="flex items-center gap-3" aria-label={t('common.appName')}>
        <Logo size={36} />
        <span className="hidden text-base font-medium text-brand-navy sm:inline">
          {t('common.appName')}
        </span>
      </Link>
      <nav className="ms-auto" aria-label={t('navigation.primary')} />
    </header>
  );
}
