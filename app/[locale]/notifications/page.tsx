import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { NotificationList } from '@/components/notifications/NotificationList';
import {
  countNotificationsForCurrentUser,
  listNotificationsForCurrentUser,
} from '@/lib/notifications/queries';

const PAGE_SIZE = 30;

/**
 * Full notifications page (Prompt 9 §4.2.2 "View all").
 *
 * Every authenticated role can reach this — the gate is "logged in"
 * rather than role-scoped. Notifications are inherently per-recipient,
 * so RBAC is implicit (the queries scope by `recipientId = session.user.id`).
 */
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  const t = await getTranslations('notifications');

  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const [rows, total] = await Promise.all([
    listNotificationsForCurrentUser(PAGE_SIZE, skip),
    countNotificationsForCurrentUser(),
  ]);

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      <NotificationList rows={rows} total={total} page={page} pageSize={PAGE_SIZE} />
    </section>
  );
}
