import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { InboxShell } from '@/components/whatsapp-inbox/InboxShell';
import { listActivePatientsBrief } from '@/lib/appointments/queries';
import { getEffectiveSession } from '@/lib/impersonation/session';
import {
  canAccessInbox,
  getThread,
  listConversations,
  type InboxFilter,
} from '@/lib/whatsapp/inbox/queries';
import { requirePermission } from '@/lib/rbac/guards';

export const dynamic = 'force-dynamic';

/**
 * WhatsApp Inbox (Prompt 49) — SECRETARY + ADMIN only. The clinic number is
 * API-only (rule #12), so this page IS the phone: conversations, thread,
 * free-text replies inside the 24h window, and unknown-number linking.
 * Lives at /secretary/whatsapp because /secretary/inbox is the existing
 * InboxItem triage queue (investigation finding — reported).
 */
export default async function WhatsAppInboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('appointments.read');
  const session = await getEffectiveSession();
  if (!session?.user || !canAccessInbox(session.user.role)) {
    redirect(`/${locale}/`);
  }
  const sp = await searchParams;
  const filter = (
    sp.f && ['all', 'unread', 'unknown'].includes(sp.f) ? sp.f : 'all'
  ) as InboxFilter;
  const search = sp.q ?? '';
  const t = await getTranslations('waInbox');

  const [conversations, thread, patients] = await Promise.all([
    listConversations(filter, search),
    sp.c ? getThread(sp.c, session.user.role) : Promise.resolve(null),
    listActivePatientsBrief(),
  ]);

  return (
    <section className="flex h-[calc(100vh-4rem)] flex-col p-4 sm:p-6">
      <h1 className="mb-3 text-2xl font-medium text-brand-navy">{t('title')}</h1>
      <InboxShell
        conversations={conversations}
        thread={thread}
        filter={filter}
        search={search}
        viewerRole={session.user.role}
        patients={patients.map((p) => ({
          id: p.id,
          fullNameEn: p.fullNameEn,
          fullNameAr: p.fullNameAr,
          phone: p.phone,
        }))}
      />
    </section>
  );
}
