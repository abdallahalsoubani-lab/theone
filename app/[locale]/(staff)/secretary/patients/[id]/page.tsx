import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PatientFilePage } from '@/components/patients/PatientFilePage';
import { getPatientPlanState } from '@/lib/clinical/plans/queries';
import { listIntakesForPatient } from '@/lib/intake/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { getPatientFile } from '@/lib/patients/queries';
import { listPatientActivity } from '@/lib/patients/queries-audit';
import { requirePermission } from '@/lib/rbac/guards';

export default async function SecretaryPatientFilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.read');
  await ensureCanReadPatient(id);
  const [patient, activity, intakes, planState] = await Promise.all([
    getPatientFile(id),
    listPatientActivity(id),
    listIntakesForPatient(id),
    getPatientPlanState(id),
  ]);
  if (!patient) notFound();
  return (
    <PatientFilePage
      patient={patient}
      activity={activity}
      intakes={intakes}
      basePath="/secretary/patients"
      canEdit
      canResetPassword
      locale={locale === 'ar' ? 'ar' : 'en'}
      planState={planState}
      viewerRole="SECRETARY"
    />
  );
}
