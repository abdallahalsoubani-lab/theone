import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { HomeProgramReviewCard } from '@/components/home-program/HomeProgramReviewCard';
import { listPendingApprovals } from '@/lib/clinical/home-program/approval';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Doctor home-program approval queue (Prompt 16). Lists the programs awaiting
 * review (the doctor's care-team patients; Admin sees all) with Approve /
 * Request-changes inline.
 */
export default async function DoctorApprovalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('home_program.approve');
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);
  const t = await getTranslations('clinical.homeProgram.approval');

  const careTeamDoctorId = session.user.role === 'ADMIN' ? null : session.user.id;
  const pending = await listPendingApprovals(careTeamDoctorId);

  return (
    <section className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('queueTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('queueSubtitle')}</p>
      </header>
      {pending.length === 0 ? (
        <p className="rounded-md border border-brand-border bg-brand-bg p-4 text-sm text-brand-textMuted">
          {t('queueEmpty')}
        </p>
      ) : (
        <div className="grid gap-3">
          {pending.map((row) => (
            <HomeProgramReviewCard key={row.patientId} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}
