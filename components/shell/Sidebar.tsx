'use client';

import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Link, usePathname } from '@/i18n/navigation';
import type { StaffNavBadge } from '@/components/shell/staff-nav';
import { getNavBadgeCountsAction } from '@/lib/shell/actions';
import type { NavBadgeCounts } from '@/lib/shell/nav-badges';
import { cn } from '@/lib/utils';

/** How often the badges re-read their counts. Matches the notification bell's
 *  cadence — these are "somebody did something elsewhere" counters, not
 *  live data. */
const POLL_MS = 60_000;

export interface NavLink {
  /** Localized label. Already-translated string — caller handles i18n. */
  label: string;
  /** Path relative to the locale root, e.g. `/calendar` (NOT `/en/calendar`). */
  href: string;
  /** Optional icon node. */
  icon?: React.ReactNode;
  /** Optional unread / count badge — e.g. unread inbox items. */
  badge?: number;
  /** Which counter this badge tracks, so the poll can update it in place. */
  badgeKey?: StaffNavBadge;
}

/** Collapse preference key — survives refreshes; per-browser convenience. */
const COLLAPSE_KEY = 'theone-sidebar-collapsed';

/**
 * Desktop sidebar (Prompt 3 §4.5).
 *
 * Hidden below md. Renders whatever links the caller passes; later prompts
 * (calendar, admin panel, patient portal) compose their own role-scoped lists.
 * Empty list renders an explanatory empty state — never silent emptiness.
 *
 * Collapsible (owner request 24 Aug 2026, phone-landscape photo): on a
 * phone held sideways the md: breakpoint shows this sidebar and it eats
 * half the calendar. A toggle collapses it to a slim rail (the reopen
 * button stays visible) at EVERY size ≥ md; the choice persists in
 * localStorage. The below-md drawer (MobileNav) is untouched.
 */
export function Sidebar({ links }: { links: ReadonlyArray<NavLink> }) {
  const pathname = usePathname();
  const t = useTranslations('navigation');
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true);
    } catch {
      /* storage unavailable — stay expanded */
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  // PT-B4 item 3 — the counts arrive with the first server render of the
  // (staff) layout, which the App Router then reuses across sibling
  // navigations without re-running it. Left alone the badges freeze: three
  // intake requests would arrive and the sidebar would still read "1". Poll
  // (and refresh on focus, the moment the secretary looks back at the tab).
  const [counts, setCounts] = useState<NavBadgeCounts | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      const next = await getNavBadgeCountsAction();
      if (!cancelled && next) setCounts(next);
    };
    const id = window.setInterval(() => void tick(), POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const badgeOf = (link: NavLink): number | undefined =>
    link.badgeKey && counts ? counts[link.badgeKey] : link.badge;

  if (collapsed) {
    return (
      <aside
        aria-label={t('primary')}
        className="hidden w-10 shrink-0 flex-col items-center border-e border-brand-border/70 bg-brand-surface py-4 md:flex"
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          title={t('expandMenu')}
          aria-label={t('expandMenu')}
          aria-expanded={false}
          className="rounded-md p-1.5 text-brand-textMuted transition-colors hover:bg-brand-bg hover:text-brand-navy"
        >
          <PanelRightOpen className="size-5 rtl:-scale-x-100" aria-hidden />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label={t('primary')}
      className="hidden w-60 shrink-0 border-e border-brand-border/70 bg-brand-surface py-6 md:flex md:flex-col"
    >
      {/* Labeled, full-width toggle (owner follow-up 24 Aug: the icon-only
          button was easy to miss on a phone) — reads like a nav row. */}
      <div className="mb-2 px-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={true}
          className="flex w-full items-center gap-3 rounded-lg border border-brand-border/70 px-3 py-2 text-sm font-medium text-brand-textMuted transition-colors hover:bg-brand-bg hover:text-brand-navy"
        >
          <PanelRightClose className="size-5 shrink-0 rtl:-scale-x-100" aria-hidden />
          <span className="truncate">{t('collapseMenu')}</span>
        </button>
      </div>
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
                {(() => {
                  const badge = badgeOf(link);
                  return badge != null && badge > 0 ? (
                    <span className="ms-auto rounded-full bg-brand-cyan/20 px-2 py-0.5 text-[11px] font-semibold text-brand-blue ring-1 ring-inset ring-brand-cyan/30">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  ) : null;
                })()}
              </Link>
            );
          })}
        </nav>
      )}
    </aside>
  );
}
