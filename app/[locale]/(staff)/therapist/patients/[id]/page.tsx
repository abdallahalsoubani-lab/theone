import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import { PatientFilePage } from '@/components/patients/PatientFilePage';
import { getPatientPlanState } from '@/lib/clinical/plans/queries';
import { listSessionNotesForPatient } from '@/lib/clinical/session-notes/queries';
import { listIntakesForPatient } from '@/lib/intake/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { getPatientFile } from '@/lib/patients/queries';
import { listPatientActivity } from '@/lib/patients/queries-audit';
import { requirePermission } from '@/lib/rbac/guards';

export default async function TherapistPatientFilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.read.assigned');
  await ensureCanReadPatient(id);
  const session = await auth();
  const [patient, activity, intakes, planState, notes] = await Promise.all([
    getPatientFile(id),
    listPatientActivity(id),
    listIntakesForPatient(id),
    getPatientPlanState(id),
    listSessionNotesForPatient(id),
  ]);
  if (!patient) notFound();
  return (
    <PatientFilePage
      patient={patient}
      activity={activity}
      intakes={intakes}
      basePath="/therapist/patients"
      canEdit={false}
      canResetPassword={false}
      locale={locale === 'ar' ? 'ar' : 'en'}
      planState={planState}
      notes={notes}
      viewerRole="THERAPIST"
      actorId={session?.user?.id ?? ''}
    />
  );
}
