import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import { PlanCard } from '@/components/clinical/PlanCard';
import { getPlanById } from '@/lib/clinical/plans/queries';
import { requirePermission } from '@/lib/rbac/guards';

export default async function DoctorPlanPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('treatment_plans.read.assigned', {});
  const t = await getTranslations('clinical.plans');
  const session = await auth();
  const plan = await getPlanById(id);
  if (!plan) notFound();

  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('viewPlanTitle')}</h1>
      </header>
      <PlanCard
        plan={plan}
        viewerRole={(session?.user?.role ?? 'DOCTOR') as 'DOCTOR'}
        editHref={plan.status === 'ACTIVE' ? `/doctor/patients/${plan.patientId}` : undefined}
      />
    </section>
  );
}
