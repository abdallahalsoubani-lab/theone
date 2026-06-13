import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PediatricAssessmentForm } from '@/components/pediatric-assessment/PediatricAssessmentForm';
import { listActiveCustomFields } from '@/lib/pediatric-assessment/customFields/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { getPatientFile } from '@/lib/patients/queries';
import { requirePermission } from '@/lib/rbac/guards';

import { clinicToday, dobAgeString } from '../helpers';

export default async function NewPediatricAssessmentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('pediatric_assessment.create');
  await ensureCanReadPatient(id);
  const ar = locale === 'ar';

  const [patient, customFields, t] = await Promise.all([
    getPatientFile(id),
    listActiveCustomFields(),
    getTranslations('pediatricAssessment'),
  ]);
  if (!patient) notFound();

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('newAssessment')}</h1>
      <PediatricAssessmentForm
        mode="create"
        patientId={patient.id}
        patientName={ar ? patient.fullNameAr : patient.fullNameEn}
        dobAge={dobAgeString(patient.dateOfBirth, ar)}
        today={clinicToday()}
        customFields={customFields}
        backHref={`/doctor/patients/${patient.id}`}
        locale={locale}
      />
    </section>
  );
}
