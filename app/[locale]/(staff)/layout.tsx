import {
  Calendar,
  CalendarX,
  ClipboardCheck,
  ClipboardList,
  Dumbbell,
  Inbox,
  ListChecks,
  Users,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/auth';
import { Sidebar, type NavLink } from '@/components/shell/Sidebar';
import { countUnresolvedInbox } from '@/lib/inbox/queries';
import { countPendingSubmissions } from '@/lib/intake-submissions/queries';
import { countActiveWaitlist } from '@/lib/waitlist/queries';

/**
 * Staff route group layout.
 *
 * Gates the subtree to SECRETARY / DOCTOR / THERAPIST (admins can still reach
 * staff views since admin permissions are a superset). The sidebar adapts to
 * the active role.
 */
export default async function StaffLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  const role = session.user.role;
  if (role === 'PATIENT') redirect(`/${locale}/`);

  const tNav = await getTranslations('navigation');
  const tPatients = await getTranslations('patients');

  const links: NavLink[] = [];
  if (role === 'SECRETARY' || role === 'ADMIN') {
    const [inboxCount, waitlistCount, intakeSubmissionCount] = await Promise.all([
      countUnresolvedInbox(),
      countActiveWaitlist(),
      countPendingSubmissions(),
    ]);
    links.push(
      {
        label: tNav('appointments'),
        href: '/secretary/calendar',
        icon: <Calendar className="size-4" />,
      },
      {
        label: tNav('arrivals'),
        href: '/secretary/arrivals',
        icon: <UserCheck className="size-4" />,
      },
      {
        label: tNav('waitlist'),
        href: '/secretary/waitlist',
        icon: <ListChecks className="size-4" />,
        badge: waitlistCount,
      },
      {
        label: tNav('cancelled'),
        href: '/secretary/appointments/cancelled',
        icon: <CalendarX className="size-4" />,
      },
      {
        label: tPatients('navTitle'),
        href: '/secretary/patients',
        icon: <Users className="size-4" />,
      },
      {
        label: tNav('intakeSubmissions'),
        href: '/secretary/intake-submissions',
        icon: <UserPlus className="size-4" />,
        badge: intakeSubmissionCount,
      },
      {
        label: tNav('inbox'),
        href: '/secretary/inbox',
        icon: <Inbox className="size-4" />,
        badge: inboxCount,
      },
    );
  } else if (role === 'DOCTOR') {
    links.push(
      {
        label: tNav('appointments'),
        href: '/doctor/dashboard',
        icon: <Calendar className="size-4" />,
      },
      {
        label: tNav('calendar'),
        href: '/doctor/calendar',
        icon: <Calendar className="size-4" />,
      },
      // Waitlist removed from the Doctor sidebar (QA retest #1): it linked to
      // the Secretary-only /secretary/waitlist route, so it never navigated for
      // a Doctor. There is no Doctor-scoped waitlist view in v1.
      {
        label: tNav('cancelled'),
        href: '/doctor/appointments/cancelled',
        icon: <CalendarX className="size-4" />,
      },
      {
        label: tPatients('navTitle'),
        href: '/doctor/patients',
        icon: <Users className="size-4" />,
      },
      {
        label: tNav('treatmentPlans'),
        href: '/doctor/plans',
        icon: <ClipboardList className="size-4" />,
      },
      {
        label: tNav('approvals'),
        href: '/doctor/approvals',
        icon: <ClipboardCheck className="size-4" />,
      },
      {
        label: tNav('exerciseLibrary'),
        href: '/clinical/exercises',
        icon: <Dumbbell className="size-4" />,
      },
    );
  } else if (role === 'THERAPIST') {
    links.push(
      {
        label: tNav('appointments'),
        href: '/therapist/dashboard',
        icon: <Calendar className="size-4" />,
      },
      {
        label: tNav('calendar'),
        href: '/therapist/calendar',
        icon: <Calendar className="size-4" />,
      },
      {
        label: tPatients('navTitle'),
        href: '/therapist/patients',
        icon: <Users className="size-4" />,
      },
      {
        label: tNav('exerciseLibrary'),
        href: '/clinical/exercises',
        icon: <Dumbbell className="size-4" />,
      },
    );
  }

  return (
    <div className="flex">
      <Sidebar links={links} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
