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
  /** Optional unread / count badge — e.g. unread inbox items. */
  badge?: number;
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
      className="hidden w-60 shrink-0 border-e border-brand-border/70 bg-brand-surface py-6 md:flex md:flex-col"
    >
      {links.length === 0 ? (
        <p className="px-4 text-sm text-brand-textMuted">{t('empty')}</p>
      ) : (
        <nav className="flex flex-col gap-0.5 px-3">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={`${link.label}:${link.href}`}
                href={link.href}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
                  active
                    ? 'bg-brand-cyan/10 text-brand-navy'
                    : 'text-brand-textMuted hover:bg-brand-bg hover:text-brand-navy',
                )}
                aria-current={active ? 'page' : undefined}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-brand-cyan"
                  />
                ) : null}
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center transition-colors',
                    active ? 'text-brand-blue' : 'text-brand-textMuted group-hover:text-brand-navy',
                  )}
                >
                  {link.icon}
                </span>
                <span className="flex-1 truncate">{link.label}</span>
                {link.badge != null && link.badge > 0 ? (
                  <span className="ms-auto rounded-full bg-brand-cyan/20 px-2 py-0.5 text-[11px] font-semibold text-brand-blue ring-1 ring-inset ring-brand-cyan/30">
                    {link.badge > 99 ? '99+' : link.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      )}
    </aside>
  );
}
