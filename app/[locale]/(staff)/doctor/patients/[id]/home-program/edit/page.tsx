import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { HomeProgramApprovalPanel } from '@/components/home-program/HomeProgramApprovalPanel';
import { HomeProgramBuilder } from '@/components/home-program/HomeProgramBuilder';
import { getApprovalState } from '@/lib/clinical/home-program/approval';
import { listHomeProgramForPatient } from '@/lib/clinical/home-program/queries';
import { listExerciseOptions } from '@/lib/clinical/plans/exercises';
import { db } from '@/lib/db';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Doctor home-program builder (Prompt 16). The doctor authors plans AND can
 * build home programs directly — their edits auto-approve (the doctor is the
 * approver), so there's no Submit button (canSubmit=false); the reminders
 * toggle is still available.
 */
export default async function DoctorHomeProgramEditPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('home_program.create');
  await ensureCanReadPatient(id);
  const t = await getTranslations('clinical.homeProgram');

  const [patient, items, exerciseOptions, approval] = await Promise.all([
    db.user.findUnique({
      where: { id },
      select: { id: true, fullNameEn: true, fullNameAr: true, role: true },
    }),
    listHomeProgramForPatient(id),
    listExerciseOptions(),
    getApprovalState(id),
  ]);
  if (!patient || patient.role !== 'PATIENT') notFound();

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
        canSubmit={false}
      />
      <HomeProgramBuilder patientId={patient.id} items={items} exerciseOptions={exerciseOptions} />
    </section>
  );
}
