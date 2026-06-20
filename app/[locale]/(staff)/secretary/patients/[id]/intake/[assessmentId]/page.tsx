import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { IntakeAssessmentView } from '@/components/intake/IntakeAssessmentView';
import { getIntakeAssessmentById } from '@/lib/intake/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';

/** Read-only view of a completed intake assessment (Fix 6B item 4). */
export default async function IntakeAssessmentPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; assessmentId: string }>;
}) {
  const { locale, id, assessmentId } = await params;
  setRequestLocale(locale);
  await ensureCanReadPatient(id);
  const assessment = await getIntakeAssessmentById(assessmentId);
  if (!assessment || assessment.patientId !== id) notFound();
  return (
    <IntakeAssessmentView
      assessment={assessment}
      backHref={`/secretary/patients/${id}`}
      locale={locale === 'ar' ? 'ar' : 'en'}
    />
  );
}
