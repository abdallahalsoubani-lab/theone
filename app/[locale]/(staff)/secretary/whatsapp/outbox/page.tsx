import { setRequestLocale } from 'next-intl/server';

import { OutboxPageContent } from '@/components/admin/OutboxPageContent';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Secretary WhatsApp outbox (P58 item 2) — the same page the admin has,
 * mounted under the (staff) route group because the (admin) layout
 * hard-redirects non-ADMIN sessions (role-scoped-path convention; the body
 * is one shared component, not a fork). The `whatsapp_outbox.read` gate is
 * the authority: SECRETARY holds it since P58; DOCTOR/THERAPIST hit
 * ForbiddenError here even though the (staff) layout admits them.
 */
export default async function SecretaryOutboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('whatsapp_outbox.read');
  return <OutboxPageContent />;
}
