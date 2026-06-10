import {
  BriefcaseMedical,
  CalendarDays,
  ClipboardList,
  DoorOpen,
  MessageSquare,
  ScrollText,
  Settings,
  Users,
} from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { auth } from '@/auth';
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
  const links: NavLink[] = [
    { label: t('calendar'), href: '/admin/calendar', icon: <CalendarDays className="size-4" /> },
    { label: t('users'), href: '/admin/users', icon: <Users className="size-4" /> },
    {
      label: t('specialties'),
      href: '/admin/specialties',
      icon: <BriefcaseMedical className="size-4" />,
    },
    { label: t('rooms'), href: '/admin/rooms', icon: <DoorOpen className="size-4" /> },
    {
      label: t('customQuestions'),
      href: '/admin/intake-questions',
      icon: <ClipboardList className="size-4" />,
    },
    {
      label: t('whatsappTemplates'),
      href: '/admin/whatsapp/templates',
      icon: <MessageSquare className="size-4" />,
    },
    {
      label: t('whatsappMessages'),
      href: '/admin/whatsapp/messages',
      icon: <MessageSquare className="size-4" />,
    },
    { label: t('settings'), href: '/admin/settings', icon: <Settings className="size-4" /> },
    { label: t('audit'), href: '/admin/audit', icon: <ScrollText className="size-4" /> },
  ];

  return (
    <div className="flex">
      <Sidebar links={links} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
