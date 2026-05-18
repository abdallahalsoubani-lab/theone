import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { HomeProgramBuilder } from '@/components/home-program/HomeProgramBuilder';
import { listHomeProgramForPatient } from '@/lib/clinical/home-program/queries';
import { listExerciseOptions } from '@/lib/clinical/plans/exercises';
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

  const [patient, items, exerciseOptions] = await Promise.all([
    db.user.findUnique({
      where: { id },
      select: { id: true, fullNameEn: true, fullNameAr: true, role: true },
    }),
    listHomeProgramForPatient(id),
    listExerciseOptions(),
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
      <HomeProgramBuilder patientId={patient.id} items={items} exerciseOptions={exerciseOptions} />
    </section>
  );
}
