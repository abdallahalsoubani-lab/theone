'use client';

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface NavLink {
  /** Localized label. Already-translated string — caller handles i18n. */
  label: string;
  /** Path relative to the locale root, e.g. `/calendar` (NOT `/en/calendar`). */
  href: string;
  /** Optional icon node. */
  icon?: React.ReactNode;
}

/**
 * Desktop sidebar (Prompt 3 §4.5).
 *
 * Hidden below md. Renders whatever links the caller passes; later prompts
 * (calendar, admin panel, patient portal) compose their own role-scoped lists.
 * Empty list renders an explanatory empty state — never silent emptiness.
 */
export function Sidebar({ links }: { links: ReadonlyArray<NavLink> }) {
  const pathname = usePathname();
  const t = useTranslations('navigation');

  return (
    <aside
      aria-label={t('primary')}
      className="hidden w-60 shrink-0 border-e border-brand-border bg-brand-surface py-6 md:flex md:flex-col"
    >
      {links.length === 0 ? (
        <p className="px-4 text-sm text-brand-textMuted">{t('empty')}</p>
      ) : (
        <nav className="flex flex-col gap-1 px-2">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand-bg text-brand-navy'
                    : 'text-brand-textMuted hover:bg-brand-bg hover:text-brand-navy',
                )}
                aria-current={active ? 'page' : undefined}
              >
                {link.icon}
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </aside>
  );
}
