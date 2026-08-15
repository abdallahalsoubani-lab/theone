import { getTranslations, setRequestLocale } from 'next-intl/server';

import { OutboxRecent } from '@/components/admin/OutboxRecent';
import { OutboxSection } from '@/components/admin/OutboxSection';
import { requirePermission } from '@/lib/rbac/guards';
import { getOutbox } from '@/lib/whatsapp/dispatch/queries';

/**
 * Admin WhatsApp outbox (P48 §4.4) — three independent sections (bookings /
 * reschedules / cancellations), each with its own counter and Send button.
 * ADMIN-only: the permission gate below is the authority; no other role has
 * a nav entry, and a direct URL hits ForbiddenError here.
 */
export default async function OutboxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('whatsapp_outbox.read');
  const t = await getTranslations('admin.outbox');
  const data = await getOutbox();

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      <OutboxSection type="BOOKING_CONFIRMATION" rows={data.pending.BOOKING_CONFIRMATION} />
      <OutboxSection type="RESCHEDULE" rows={data.pending.RESCHEDULE} />
      <OutboxSection type="CANCELLATION" rows={data.pending.CANCELLATION} />
      <OutboxRecent rows={data.recent} />
    </section>
  );
}
