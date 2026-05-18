import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { InboxTable } from '@/components/inbox/InboxTable';
import { listUnresolvedInbox } from '@/lib/inbox/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Secretary inbox (Prompt 8 §4.8).
 *
 * Lists unresolved action items raised by:
 *   - Inbound RESCHEDULE_REQUEST / CANCEL_REQUEST / UNKNOWN messages
 *     parsed by lib/whatsapp/inbound/process.ts
 *   - Outbound delivery failures (the worker flips
 *     User.whatsappReachable=false and drops a row here)
 *
 * The Secretary works the list to call the patient back / fix the phone
 * number / open the calendar to reschedule. There is no auto-resolve — a
 * human always decides the item is closed.
 */
export default async function SecretaryInboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('inbox.read');
  const t = await getTranslations('secretary.inbox');
  const rows = await listUnresolvedInbox();

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
          <Badge variant="muted">{rows.length}</Badge>
        </div>
        <p className="text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      <InboxTable rows={rows} />
    </section>
  );
}
