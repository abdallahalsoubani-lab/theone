import { getTranslations, setRequestLocale } from 'next-intl/server';

import { OutboxRecent } from '@/components/admin/OutboxRecent';
import { OutboxSection } from '@/components/admin/OutboxSection';
import { SilentModeBanner } from '@/components/admin/SilentModeBanner';
import { requirePermission } from '@/lib/rbac/guards';
import { getOutbox } from '@/lib/whatsapp/dispatch/queries';
import { isSilentModeOn } from '@/lib/whatsapp/silent-mode';

/**
 * Admin WhatsApp outbox (P48 §4.4, extended by P51) — six independent
 * sections (bookings / reschedules / cancellations + the silent-mode held
 * reminders / arrivals / home-program), each with its own counter and Send.
 * ADMIN-only: the permission gate below is the authority; no other role has
 * a nav entry, and a direct URL hits ForbiddenError here.
 */
export default async function OutboxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('whatsapp_outbox.read');
  const t = await getTranslations('admin.outbox');
  const [data, silent] = await Promise.all([getOutbox(), isSilentModeOn()]);

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      {silent ? <SilentModeBanner /> : null}
      <OutboxSection type="BOOKING_CONFIRMATION" rows={data.pending.BOOKING_CONFIRMATION} />
      <OutboxSection type="RESCHEDULE" rows={data.pending.RESCHEDULE} />
      <OutboxSection type="CANCELLATION" rows={data.pending.CANCELLATION} />
      {/* P51 — the silent-mode held classes, same interaction pattern. */}
      <OutboxSection type="REMINDER" rows={data.pending.REMINDER} />
      <OutboxSection type="ARRIVAL" rows={data.pending.ARRIVAL} />
      <OutboxSection type="HOME_PROGRAM" rows={data.pending.HOME_PROGRAM} />
      <OutboxRecent rows={data.recent} />
    </section>
  );
}
