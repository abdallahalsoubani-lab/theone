import {
  Calendar,
  CalendarX,
  ClipboardCheck,
  ClipboardList,
  Dumbbell,
  Inbox,
  ListChecks,
  MessageCircle,
  Users,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Sidebar, type NavLink } from '@/components/shell/Sidebar';
import { staffNavEntries, type StaffNavEntry } from '@/components/shell/staff-nav';
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
const ICONS: Record<StaffNavEntry['icon'], ReactNode> = {
  calendar: <Calendar className="size-4" />,
  userCheck: <UserCheck className="size-4" />,
  listChecks: <ListChecks className="size-4" />,
  calendarX: <CalendarX className="size-4" />,
  users: <Users className="size-4" />,
  userPlus: <UserPlus className="size-4" />,
  inbox: <Inbox className="size-4" />,
  clipboardList: <ClipboardList className="size-4" />,
  clipboardCheck: <ClipboardCheck className="size-4" />,
  dumbbell: <Dumbbell className="size-4" />,
  messageCircle: <MessageCircle className="size-4" />,
};

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
      icon: ICONS[e.icon],
      ...(e.badge ? { badge: badgeValue[e.badge], badgeKey: e.badge } : {}),
    };
  });

  return (
    <div className="flex">
      <Sidebar links={links} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
