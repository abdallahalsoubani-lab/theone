import { setRequestLocale } from 'next-intl/server';

import { OutboxPageContent } from '@/components/admin/OutboxPageContent';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Admin WhatsApp outbox (P48 §4.4, extended by P51) — six independent
 * sections (bookings / reschedules / cancellations + the silent-mode held
 * reminders / arrivals / home-program), each with its own counter and Send.
 * P58: the body moved to OutboxPageContent, shared verbatim with the
 * secretary mirror route; the `whatsapp_outbox.read` gate (ADMIN +
 * SECRETARY since P58) is the authority on access.
 */
export default async function OutboxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('whatsapp_outbox.read');
  return <OutboxPageContent />;
}
