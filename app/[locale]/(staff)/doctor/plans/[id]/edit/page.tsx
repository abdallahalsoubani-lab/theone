import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PlanForm } from '@/components/clinical/PlanForm';
import { listActiveClinicians } from '@/lib/appointments/queries';
import { listExerciseOptionsIncluding } from '@/lib/clinical/plans/exercises';
import { getPlanById } from '@/lib/clinical/plans/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Doctor — edit treatment plan page (QA 6.1).
 *
 * Mirrors the therapist propose-change page, but submits through
 * `updateTreatmentPlanAction`: plans are immutable versions, so saving
 * creates the next ACTIVE version and supersedes this one. Only ACTIVE
 * plans are editable; the service additionally binds the edit to the
 * authoring doctor.
 */
export default async function EditPlanPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('treatment_plans.update.own');
  const t = await getTranslations('clinical.plans');

  const plan = await getPlanById(id);
  if (!plan || plan.status !== 'ACTIVE') notFound();

  const [clinicians, exercises] = await Promise.all([
    listActiveClinicians(),
    // Active catalog + versions this plan already references (QA 6.3).
    listExerciseOptionsIncluding(plan.exercises.map((e) => e.exerciseId)),
  ]);
  const therapists = clinicians
    .filter((c) => c.role === 'THERAPIST')
    .map((c) => ({ id: c.id, fullNameEn: c.fullNameEn, fullNameAr: c.fullNameAr }));

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('editTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('editSubtitle')}</p>
      </header>
      <PlanForm
        editPlanId={plan.id}
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
        redirectTo={`/doctor/patients/${plan.patientId}`}
      />
    </section>
  );
}
