import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ArrivalsPanel } from '@/components/arrivals/ArrivalsPanel';
import { getArrivalsBoard } from '@/lib/arrivals/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Secretary/Admin arrivals desk (Prompt 18 §2). The live waiting list +
 * current-delay quick-edit. Gated by `arrivals.manage` (Secretary + Admin).
 */
export const dynamic = 'force-dynamic';

export default async function ArrivalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('arrivals.manage');
  const t = await getTranslations('arrivals');
  const board = await getArrivalsBoard();

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('subtitle')}</p>
      </header>
      <ArrivalsPanel board={board} locale={locale} />
    </section>
  );
}
