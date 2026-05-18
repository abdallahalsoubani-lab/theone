import { getTranslations, setRequestLocale } from 'next-intl/server';

import { MessagesTable } from '@/components/admin/whatsapp/MessagesTable';
import { listMessages } from '@/lib/admin/whatsapp/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Admin WhatsApp message log (Prompt 8 §4.10).
 *
 * Shows the most recent 50 messages (newest first) with direction +
 * status + recipient + body preview + provider message id. FAILED
 * outbound rows expose a "Resend" action (capped at 3 resends per
 * message ever).
 *
 * Filters are surfaced via URL params; the table component reads them
 * from useSearchParams to avoid round-tripping every checkbox.
 */
export default async function AdminMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('whatsapp_messages.read');
  const t = await getTranslations('admin.whatsapp');
  const sp = await searchParams;

  const rows = await listMessages({
    direction: sp.direction === 'OUTBOUND' || sp.direction === 'INBOUND' ? sp.direction : undefined,
    status:
      sp.status === 'QUEUED' ||
      sp.status === 'SENT' ||
      sp.status === 'DELIVERED' ||
      sp.status === 'READ' ||
      sp.status === 'FAILED'
        ? sp.status
        : undefined,
    recipientPhone: sp.phone || undefined,
  });

  return (
    <section className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('messagesTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('messagesSubtitle')}</p>
      </header>
      <MessagesTable
        rows={rows}
        initialFilters={{
          direction: sp.direction ?? '',
          status: sp.status ?? '',
          phone: sp.phone ?? '',
        }}
      />
    </section>
  );
}
