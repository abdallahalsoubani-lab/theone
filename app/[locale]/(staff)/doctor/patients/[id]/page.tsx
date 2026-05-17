import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { PatientFilePage } from '@/components/patients/PatientFilePage';
import { listIntakesForPatient } from '@/lib/intake/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { getPatientFile } from '@/lib/patients/queries';
import { listPatientActivity } from '@/lib/patients/queries-audit';
import { requirePermission } from '@/lib/rbac/guards';

export default async function DoctorPatientFilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.read.assigned');
  await ensureCanReadPatient(id);
  const [patient, activity, intakes] = await Promise.all([
    getPatientFile(id),
    listPatientActivity(id),
    listIntakesForPatient(id),
  ]);
  if (!patient) notFound();
  return (
    <PatientFilePage
      patient={patient}
      activity={activity}
      intakes={intakes}
      basePath="/doctor/patients"
      canEdit={false}
      canResetPassword={false}
      locale={locale === 'ar' ? 'ar' : 'en'}
    />
  );
}
