import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PlanForm } from '@/components/clinical/PlanForm';
import { listActiveClinicians } from '@/lib/appointments/queries';
import { listExerciseOptions } from '@/lib/clinical/plans/exercises';
import { db } from '@/lib/db';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Therapist — propose the FIRST treatment plan (P64 #10). Same shared
 * PlanForm as the doctor's create page, in `initialProposal` mode: the plan
 * is saved PROPOSED and waits for a doctor's approval. The service refuses
 * when an active plan or a pending proposal already exists.
 */
export default async function TherapistNewPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ patientId?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requirePermission('treatment_plans.propose');
  const t = await getTranslations('clinical.plans');

  const sp = await searchParams;
  if (!sp.patientId) notFound();
  const patient = await db.user.findUnique({
    where: { id: sp.patientId },
    select: { id: true, fullNameEn: true, fullNameAr: true, role: true },
  });
  if (!patient || patient.role !== 'PATIENT') notFound();
  await ensureCanReadPatient(patient.id);

  const [clinicians, exercises] = await Promise.all([
    listActiveClinicians(),
    listExerciseOptions(),
  ]);
  const therapists = clinicians
    .filter((c) => c.role === 'THERAPIST')
    .map((c) => ({ id: c.id, fullNameEn: c.fullNameEn, fullNameAr: c.fullNameAr }));
  // The proposing therapist first — they are the default assignee.
  therapists.sort((a, b) => (a.id === viewer.id ? -1 : b.id === viewer.id ? 1 : 0));

  return (
    <section className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">{t('proposeInitialTitle')}</h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('proposeInitialSubtitle')}</p>
      </header>
      <PlanForm
        initialProposal
        patient={{
          id: patient.id,
          fullNameEn: patient.fullNameEn,
          fullNameAr: patient.fullNameAr,
        }}
        therapists={therapists}
        exerciseOptions={exercises}
        redirectTo={`/therapist/patients/${patient.id}`}
      />
    </section>
  );
}
