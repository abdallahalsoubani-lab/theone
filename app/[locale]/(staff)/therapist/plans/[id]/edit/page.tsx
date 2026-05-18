import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PlanForm } from '@/components/clinical/PlanForm';
import { listActiveClinicians } from '@/lib/appointments/queries';
import { listExerciseOptions } from '@/lib/clinical/plans/exercises';
import { getPlanById } from '@/lib/clinical/plans/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Therapist — propose-change page (Prompt 9 §4.4).
 *
 * Reuses the shared PlanForm with the activePlanId prefilled. The form
 * then routes its submit through proposeTreatmentPlanChangeAction
 * rather than the create path.
 */
export default async function ProposePlanChangePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('treatment_plans.propose');
  const t = await getTranslations('clinical.plans');

  const plan = await getPlanById(id);
  if (!plan || plan.status !== 'ACTIVE') notFound();

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
        <h1 className="text-2xl font-medium text-brand-navy">{t('proposeTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('proposeSubtitle')}</p>
      </header>
      <PlanForm
        activePlanId={plan.id}
        patient={{
          id: plan.patientId,
          fullNameEn: plan.patientFullNameEn,
          fullNameAr: plan.patientFullNameAr,
        }}
        therapists={therapists}
        exerciseOptions={exercises}
        initial={{
          diagnosisPrimary: plan.diagnosisPrimary,
          diagnosisSecondary: plan.diagnosisSecondary,
          goalsShortTerm: plan.goalsShortTerm,
          goalsLongTerm: plan.goalsLongTerm,
          frequencyPerWeek: plan.frequencyPerWeek,
          durationWeeks: plan.durationWeeks,
          assignedTherapistId: plan.assignedTherapistId,
          therapistNotes: plan.therapistNotes,
          exercises: plan.exercises.map((e) => ({
            exerciseId: e.exerciseId,
            sets: e.sets,
            reps: e.reps,
            durationSeconds: e.durationSeconds,
            customNotes: e.customNotes,
            order: e.order,
          })),
        }}
        redirectTo={`/therapist/plans/${plan.id}`}
      />
    </section>
  );
}
