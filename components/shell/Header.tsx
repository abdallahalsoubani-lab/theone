import { Bell } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { LanguageToggle } from './LanguageToggle';
import { MobileNav } from './MobileNav';

/**
 * Site header (Prompt 3 §4.4).
 *
 * Sticky 64px bar; structure mirrors automatically under RTL because every
 * spacing class is logical (ms-/me-/start-/end-). The user-menu spot is a
 * placeholder "Sign in" until Prompt 4 lands the real authenticated dropdown.
 *
 * Sidebar is not rendered here — pages that need it (secretary calendar, etc.)
 * mount it inside their own layout. The header / footer pair from this prompt
 * is the only universal chrome.
 */
export async function Header() {
  const t = await getTranslations();

  return (
    <header
      className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-brand-border bg-brand-surface px-4 sm:px-6"
      aria-label={t('shell.headerLandmark')}
    >
      <MobileNav links={[]} />

      <Link
        href="/"
        className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={t('common.appName')}
      >
        <Logo size={36} />
        <span className="hidden text-base font-medium text-brand-navy sm:inline">
          {t('common.appName')}
        </span>
      </Link>

      <nav aria-label={t('navigation.primary')} className="hidden flex-1 items-center md:flex">
        {/* Role-specific links are injected by later prompts. */}
      </nav>

      <div className="ms-auto flex items-center gap-1">
        <LanguageToggle />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('shell.notifications')}
          className="hidden sm:inline-flex"
        >
          <Bell className="size-4" />
        </Button>
        <Button asChild variant="default" size="sm">
          {/* Prompt 4 swaps this for an authenticated user menu. */}
          <Link href="/login">{t('shell.signIn')}</Link>
        </Button>
      </div>
    </header>
  );
}
