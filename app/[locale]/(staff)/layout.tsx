import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { NAV_ICONS } from '@/components/shell/nav-icons';
import { Sidebar, type NavLink } from '@/components/shell/Sidebar';
import { staffNavEntries } from '@/components/shell/staff-nav';
import { getEffectiveSession } from '@/lib/impersonation/session';
import { getNavBadgeCounts } from '@/lib/shell/nav-badges';

/**
 * Staff route group layout.
 *
 * Gates the subtree to SECRETARY / DOCTOR / THERAPIST (admins can still reach
 * staff views since admin permissions are a superset). The sidebar adapts to
 * the EFFECTIVE role — during Act-As the impersonated user's role, so the
 * links always match what the page-level RBAC gates will allow (Prompt 22
 * §3.2: an impersonated Doctor must never see /secretary/* links that would
 * throw ForbiddenError).
 */
export default async function StaffLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getEffectiveSession();
  if (!session?.user) redirect(`/${locale}/login`);
  const role = session.user.role;
  if (role === 'PATIENT') redirect(`/${locale}/`);

  const tNav = await getTranslations('navigation');
  const tPatients = await getTranslations('patients');

  const entries = staffNavEntries(role);
  // First paint only — the sidebar re-reads these on a timer, because the App
  // Router reuses this layout across sibling navigations and would otherwise
  // leave the counts frozen (PT-B4 item 3). Same computation both times.
  const badgeValue = await getNavBadgeCounts(role, session.user.id);

  const links: NavLink[] = entries.map((e) => {
    const [ns, key] = e.labelKey.split(':') as ['navigation' | 'patients', string];
    return {
      label: ns === 'navigation' ? tNav(key) : tPatients(key),
      href: e.href,
      icon: NAV_ICONS[e.icon],
      ...(e.badge ? { badge: badgeValue[e.badge], badgeKey: e.badge } : {}),
    };
  });

  return (
    <div className="flex">
      <Sidebar links={links} />
      {/* min-w-0: a flex child's implicit min-width is max-CONTENT, so a wide
          calendar (13 therapist lanes) used to widen this pane past the
          viewport and scroll the whole PAGE — which dragged the hour gutter
          off-screen and defeated rbc's sticky time axis (P47 row 9). With the
          pane clamped, overflow happens INSIDE the calendar's own scroll
          container where the frozen axis works. */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
