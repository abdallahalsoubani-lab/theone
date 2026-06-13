import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PediatricAssessmentForm } from '@/components/pediatric-assessment/PediatricAssessmentForm';
import { listFieldsForAssessment } from '@/lib/pediatric-assessment/customFields/queries';
import { getAssessmentById } from '@/lib/pediatric-assessment/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { getPatientFile } from '@/lib/patients/queries';
import { requirePermission } from '@/lib/rbac/guards';

import { clinicToday, dobAgeString } from '../../helpers';

export default async function EditPediatricAssessmentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; assessmentId: string }>;
}) {
  const { locale, id, assessmentId } = await params;
  setRequestLocale(locale);
  await requirePermission('pediatric_assessment.update');
  await ensureCanReadPatient(id);
  const ar = locale === 'ar';

  const assessment = await getAssessmentById(assessmentId);
  if (!assessment || assessment.patientId !== id) notFound();

  const [patient, customFields, t] = await Promise.all([
    getPatientFile(id),
    listFieldsForAssessment(assessment.customData),
    getTranslations('pediatricAssessment'),
  ]);
  if (!patient) notFound();

  return (
    <section className="space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-medium text-brand-navy">{t('editAssessment')}</h1>
      <PediatricAssessmentForm
        mode="edit"
        patientId={patient.id}
        assessmentId={assessment.id}
        patientName={ar ? patient.fullNameAr : patient.fullNameEn}
        dobAge={dobAgeString(patient.dateOfBirth, ar)}
        today={clinicToday()}
        initialCore={assessment.coreData}
        initialCustom={assessment.customData}
        customFields={customFields}
        backHref={`/doctor/patients/${patient.id}`}
        locale={locale}
      />
    </section>
  );
}
