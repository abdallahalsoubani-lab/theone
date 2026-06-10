import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import { PatientHomeProgramTab } from '@/components/home-program/PatientHomeProgramTab';
import { PatientFilePage } from '@/components/patients/PatientFilePage';
import { getPatientHomeProgramTabData } from '@/lib/clinical/home-program/patient-tab';
import { getPatientPlanState } from '@/lib/clinical/plans/queries';
import { listSessionNotesForPatient } from '@/lib/clinical/session-notes/queries';
import { getPatientTimeline } from '@/lib/clinical/timeline/query';
import { listIntakesForPatient } from '@/lib/intake/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { getPatientFile } from '@/lib/patients/queries';
import { listPatientActivity } from '@/lib/patients/queries-audit';
import { requirePermission } from '@/lib/rbac/guards';

const TIMELINE_PAGE_SIZE = 25;

export default async function DoctorPatientFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.read.assigned');
  await ensureCanReadPatient(id);
  const sp = await searchParams;
  const timelinePage = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const session = await auth();
  const [patient, activity, intakes, planState, notes, timeline, homeProgramData] =
    await Promise.all([
      getPatientFile(id),
      listPatientActivity(id),
      listIntakesForPatient(id),
      getPatientPlanState(id),
      listSessionNotesForPatient(id),
      getPatientTimeline(
        id,
        {
          search: sp.q,
          from: sp.from ? new Date(sp.from) : undefined,
          to: sp.to ? new Date(sp.to) : undefined,
        },
        { page: timelinePage, pageSize: TIMELINE_PAGE_SIZE },
      ),
      getPatientHomeProgramTabData(id),
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
      planState={planState}
      notes={notes}
      timeline={timeline}
      timelinePage={timelinePage}
      timelinePageSize={TIMELINE_PAGE_SIZE}
      homeProgram={
        <PatientHomeProgramTab
          patientId={patient.id}
          items={homeProgramData.items}
          sevenDay={homeProgramData.sevenDay}
          thirtyDay={homeProgramData.thirtyDay}
          streak={homeProgramData.streak}
          lastCompletedById={homeProgramData.lastCompletedById}
          canEdit
          editHref={`/doctor/patients/${patient.id}/home-program/edit`}
          locale={locale === 'ar' ? 'ar' : 'en'}
        />
      }
      viewerRole="DOCTOR"
      actorId={session?.user?.id ?? ''}
    />
  );
}
