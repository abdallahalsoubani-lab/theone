import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { ConfirmationsBoard } from '@/components/appointments/ConfirmationsBoard';
import {
  CONFIRMATION_HORIZON_HOURS,
  canSeeConfirmationsList,
  listReminderConfirmations,
} from '@/lib/appointments/confirmations';
import { getEffectiveSession } from '@/lib/impersonation/session';
import { requirePermission } from '@/lib/rbac/guards';

export const dynamic = 'force-dynamic';

/**
 * Reminder confirmations page (Prompt 48b) — SECRETARY + ADMIN only. The
 * human side of "لم يتم الرد ⇒ سيتم إلغاء الموعد": grouped reply states +
 * one-click cancel through the standard flow. Placement follows the P18
 * arrivals-panel precedent (own page + sidebar badge).
 */
export default async function ConfirmationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('appointments.update');
  const session = await getEffectiveSession();
  if (!session?.user || !canSeeConfirmationsList(session.user.role)) {
    redirect(`/${locale}/`);
  }
  const t = await getTranslations('appointments.confirmations');
  const rows = await listReminderConfirmations();

  return (
    <section className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">
          {t('subtitle', { hours: String(CONFIRMATION_HORIZON_HOURS) })}
        </p>
      </header>
      <ConfirmationsBoard rows={rows} viewerRole={session.user.role} />
    </section>
  );
}
