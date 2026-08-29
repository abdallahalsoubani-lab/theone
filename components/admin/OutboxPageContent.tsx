import { getTranslations } from 'next-intl/server';

import { OutboxRecent } from '@/components/admin/OutboxRecent';
import { OutboxSection } from '@/components/admin/OutboxSection';
import { SilentModeBanner } from '@/components/admin/SilentModeBanner';
import { getOutbox } from '@/lib/whatsapp/dispatch/queries';
import { isSilentModeOn } from '@/lib/whatsapp/silent-mode';

/**
 * The outbox page body (P48 §4.4 + P51), shared by the admin route and the
 * secretary mirror route (P58 item 2 — same component, no fork). Callers own
 * the permission gate (`whatsapp_outbox.read`) and locale setup. The
 * silent-mode banner is display-only; the toggle lives on the admin settings
 * page behind the ADMIN-only `whatsapp.silent_mode` permission.
 */
export async function OutboxPageContent() {
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
