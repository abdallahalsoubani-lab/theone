import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PlanForm } from '@/components/clinical/PlanForm';
import { listActiveClinicians } from '@/lib/appointments/queries';
import { listExerciseOptions } from '@/lib/clinical/plans/exercises';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Doctor — new treatment plan page (Prompt 9 §4.3).
 *
 * Requires `?patientId=<id>` so the form has a target. Validates that
 * the patient exists; the create action enforces "no active plan
 * exists" at the service layer.
 */
export default async function NewPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ patientId?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('treatment_plans.create');
  const t = await getTranslations('clinical.plans');
  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login`);

  const sp = await searchParams;
  if (!sp.patientId) notFound();
  const patient = await db.user.findUnique({
    where: { id: sp.patientId },
    select: { id: true, fullNameEn: true, fullNameAr: true, role: true },
  });
  if (!patient || patient.role !== 'PATIENT') notFound();

  const [clinicians, exercises] = await Promise.all([
    listActiveClinicians(),
    listExerciseOptions(),
  ]);
  const therapists = clinicians
    .filter((c) => c.role === 'THERAPIST')
    .map((c) => ({ id: c.id, fullNameEn: c.fullNameEn, fullNameAr: c.fullNameAr }));

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('newPlanTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('newPlanSubtitle')}</p>
      </header>
      <PlanForm
        patient={{
          id: patient.id,
          fullNameEn: patient.fullNameEn,
          fullNameAr: patient.fullNameAr,
        }}
        therapists={therapists}
        exerciseOptions={exercises}
        redirectTo={`/doctor/patients/${patient.id}`}
      />
    </section>
  );
}
