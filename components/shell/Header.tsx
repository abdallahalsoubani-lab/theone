import { getTranslations } from 'next-intl/server';

import { auth } from '@/auth';
import { Logo } from '@/components/brand/Logo';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Link } from '@/i18n/navigation';
import { getEffectiveSession } from '@/lib/impersonation/session';
import {
  countUnreadNotificationsForCurrentUser,
  listNotificationsForCurrentUser,
} from '@/lib/notifications/queries';

import { adminNavEntries } from './admin-nav';
import { LanguageToggle } from './LanguageToggle';
import { MobileNav } from './MobileNav';
import { NAV_ICONS } from './nav-icons';
import type { NavLink } from './Sidebar';
import { staffNavEntries } from './staff-nav';
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

  // The bell needs an initial unread count + recent list so its first
  // paint isn't empty. Skipped for unauthenticated requests — keeps the
  // public landing page from issuing a db query it doesn't need.
  const [initialUnread, initialItems] = user
    ? await Promise.all([
        countUnreadNotificationsForCurrentUser(),
        listNotificationsForCurrentUser(10, 0),
      ])
    : [0, []];

  // Mobile drawer links (Prompt 46 item C — the drawer used to get a
  // hard-coded empty list). Built from the EFFECTIVE role so Act-As shows
  // the impersonated role's nav, same rule as the desktop sidebars
  // (Prompt 22 §3.2). Labels resolve through the same catalogs the
  // layouts use; badges are a desktop-sidebar affordance and are skipped.
  const effective = await getEffectiveSession();
  const effectiveRole = effective?.user?.role;
  const tNav = await getTranslations('navigation');
  const tPatients = await getTranslations('patients');
  const tAdminNav = await getTranslations('navigation.admin');
  const staffLinks: NavLink[] = effectiveRole
    ? staffNavEntries(effectiveRole).map((e) => {
        const [ns, key] = e.labelKey.split(':') as ['navigation' | 'patients', string];
        return {
          label: ns === 'navigation' ? tNav(key) : tPatients(key),
          href: e.href,
          icon: NAV_ICONS[e.icon],
        };
      })
    : [];
  const adminLinks: NavLink[] =
    effectiveRole === 'ADMIN'
      ? adminNavEntries().map((e) => ({
          label: tAdminNav(e.labelKey),
          href: e.href,
          icon: NAV_ICONS[e.icon],
        }))
      : [];

  return (
    <header
      className="header-glass sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-brand-border/70 px-4 sm:px-6"
      aria-label={t('shell.headerLandmark')}
    >
      {staffLinks.length > 0 || adminLinks.length > 0 ? (
        <MobileNav staffLinks={staffLinks} adminLinks={adminLinks} />
      ) : null}

      <Link
        href="/"
        className="group flex items-center gap-3 rounded-md transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={t('common.appName')}
      >
        {/* Owner request (26/07): the wordmark logo alone — no app-name text
            beside it (the name lives inside the logo already). Slightly
            larger to fill the freed space; aria-label keeps the name for
            screen readers. */}
        <Logo size={44} />
      </Link>

      <nav aria-label={t('navigation.primary')} className="hidden flex-1 items-center md:flex">
        {/* Role-specific links injected by later prompts. */}
      </nav>

      <div className="ms-auto flex items-center gap-1">
        <LanguageToggle />
        {user ? (
          <NotificationBell
            initialUnreadCount={initialUnread}
            initialItems={initialItems.map((i) => ({
              ...i,
              params: i.params as Record<string, string>,
            }))}
            notificationsPath="/notifications"
          />
        ) : null}
        <UserMenu user={user} />
      </div>
    </header>
  );
}
