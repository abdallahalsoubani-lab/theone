import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { IntakeAssessmentView } from '@/components/intake/IntakeAssessmentView';
import { getIntakeAssessmentById } from '@/lib/intake/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { requirePermission } from '@/lib/rbac/guards';

/** Read-only intake view inside the ADMIN interface (Prompt 33 — A-19): the
 *  admin patient file's Intake tab links here via its basePath. */
export default async function AdminIntakeAssessmentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; assessmentId: string }>;
}) {
  const { locale, id, assessmentId } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.read');
  await ensureCanReadPatient(id);
  const assessment = await getIntakeAssessmentById(assessmentId);
  if (!assessment || assessment.patientId !== id) notFound();
  return (
    <IntakeAssessmentView
      assessment={assessment}
      backHref={`/admin/patients/${id}`}
      locale={locale === 'ar' ? 'ar' : 'en'}
    />
  );
}
