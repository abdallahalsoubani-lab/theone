import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/auth';
import { adminNavEntries } from '@/components/shell/admin-nav';
import { NAV_ICONS } from '@/components/shell/nav-icons';
import { Sidebar, type NavLink } from '@/components/shell/Sidebar';

/**
 * Admin route group layout. Mounts the role-scoped Sidebar with the six
 * admin entries from Prompt 5 §4.4 and guards the entire subtree against
 * non-Admin sessions.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  if (session.user.role !== 'ADMIN') redirect(`/${locale}/`);

  const t = await getTranslations('navigation.admin');
  // P48 — the outbox badge is the total pending count (static at render;
  // navigating refreshes it).
  const { pendingOutboxCount } = await import('@/lib/whatsapp/dispatch/queries');
  const waOutbox = await pendingOutboxCount().catch(() => 0);
  // Entries live in the pure admin-nav config (Prompt 46 item C) so the
  // Header's mobile drawer renders exactly this same list.
  const links: NavLink[] = adminNavEntries().map((e) => ({
    label: t(e.labelKey),
    href: e.href,
    icon: NAV_ICONS[e.icon],
    ...(e.badge === 'waOutbox' && waOutbox > 0 ? { badge: waOutbox } : {}),
  }));

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
