import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { HomeProgramApprovalPanel } from '@/components/home-program/HomeProgramApprovalPanel';
import { HomeProgramBuilder } from '@/components/home-program/HomeProgramBuilder';
import { getApprovalState } from '@/lib/clinical/home-program/approval';
import { listHomeProgramForPatient } from '@/lib/clinical/home-program/queries';
import { listExerciseOptionsIncluding } from '@/lib/clinical/plans/exercises';
import { db } from '@/lib/db';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { requirePermission } from '@/lib/rbac/guards';

export default async function TherapistHomeProgramEditPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('home_program.create');
  await ensureCanReadPatient(id);
  const t = await getTranslations('clinical.homeProgram');

  const [patient, items, approval] = await Promise.all([
    db.user.findUnique({
      where: { id },
      select: { id: true, fullNameEn: true, fullNameAr: true, role: true },
    }),
    listHomeProgramForPatient(id),
    getApprovalState(id),
  ]);
  if (!patient || patient.role !== 'PATIENT') notFound();
  // Active catalog + the versions the existing items already reference, so
  // items pointing at archived exercises keep resolving in the picker (6.3).
  const exerciseOptions = await listExerciseOptionsIncluding(items.map((i) => i.exerciseId));

  const patientName = locale === 'ar' ? patient.fullNameAr : patient.fullNameEn;

  return (
    <section className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-medium text-brand-navy">
          {t('builderTitle', { name: patientName })}
        </h1>
        <p className="mt-1 text-sm text-brand-textMuted">{t('builderSubtitle')}</p>
      </header>
      <HomeProgramApprovalPanel
        patientId={patient.id}
        status={approval.status}
        remindersEnabled={approval.remindersEnabled}
        changesComment={approval.changesComment}
        canSubmit
        hasApprovedSnapshot={approval.hasApprovedSnapshot}
      />
      <HomeProgramBuilder patientId={patient.id} items={items} exerciseOptions={exerciseOptions} />
    </section>
  );
}
