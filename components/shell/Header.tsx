import { Bell } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/auth';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { LanguageToggle } from './LanguageToggle';
import { MobileNav } from './MobileNav';
import { UserMenu } from './UserMenu';

/**
 * Site header (Prompt 3 §4.4, extended in Prompt 4 §4.12).
 *
 * Sticky 64px bar. Hosts the locale toggle, notifications icon (placeholder
 * until Prompt 8 hooks WhatsApp delivery events), and the authenticated user
 * dropdown — falls back to a "Sign in" CTA when no session.
 *
 * Sidebar is not rendered here — pages that need it mount it inside their
 * own layout.
 */
export async function Header() {
  const t = await getTranslations();
  const session = await auth();
  const user = session?.user
    ? {
        fullNameEn: session.user.fullNameEn,
        fullNameAr: session.user.fullNameAr,
        role: session.user.role,
      }
    : null;

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
        {/* Role-specific links injected by later prompts. */}
      </nav>

      <div className="ms-auto flex items-center gap-1">
        <LanguageToggle />
        {user ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('shell.notifications')}
            className="hidden sm:inline-flex"
          >
            <Bell className="size-4" />
          </Button>
        ) : null}
        <UserMenu user={user} />
      </div>
    </header>
  );
}
