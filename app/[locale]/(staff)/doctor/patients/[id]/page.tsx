import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import { PatientHomeProgramTab } from '@/components/home-program/PatientHomeProgramTab';
import { PatientDocumentsTab } from '@/components/patients/PatientDocumentsTab';
import { PatientFilePage } from '@/components/patients/PatientFilePage';
import { listDocuments } from '@/lib/patient-documents/queries';
import { getPatientHomeProgramTabData } from '@/lib/clinical/home-program/patient-tab';
import { getPatientPlanState } from '@/lib/clinical/plans/queries';
import { listSessionNotesForPatient } from '@/lib/clinical/session-notes/queries';
import { getPatientTimeline } from '@/lib/clinical/timeline/query';
import { PediatricAssessmentTab } from '@/components/pediatric-assessment/PediatricAssessmentTab';
import { listIntakesForPatient } from '@/lib/intake/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { listAssessmentsForPatient } from '@/lib/pediatric-assessment/queries';
import { getPatientFile } from '@/lib/patients/queries';
import { listPatientActivity } from '@/lib/patients/queries-audit';
import { can } from '@/lib/rbac/can';
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
  const [
    patient,
    activity,
    intakes,
    planState,
    notes,
    timeline,
    homeProgramData,
    pedRows,
    documents,
  ] = await Promise.all([
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
    listAssessmentsForPatient(id),
    listDocuments(id),
  ]);
  if (!patient) notFound();
  const canReadPed = session?.user
    ? can(session.user, 'pediatric_assessment.read.assigned', {})
    : false;
  const canEditPed = session?.user ? can(session.user, 'pediatric_assessment.create') : false;
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
      pediatric={
        canReadPed ? (
          <PediatricAssessmentTab
            rows={pedRows}
            canEdit={canEditPed}
            basePath={`/doctor/patients/${patient.id}`}
            manageFieldsHref={canEditPed ? '/doctor/pediatric-fields' : null}
            locale={locale === 'ar' ? 'ar' : 'en'}
          />
        ) : undefined
      }
      documents={
        <PatientDocumentsTab
          patientId={patient.id}
          locale={locale === 'ar' ? 'ar' : 'en'}
          documents={documents}
          canUpload
          canDelete
          reports={{
            patientId: patient.id,
            planId: planState.active?.id ?? null,
            pediatricId: canReadPed ? (pedRows[0]?.id ?? null) : null,
            noteId: notes[0]?.id ?? null,
          }}
        />
      }
      viewerRole="DOCTOR"
      actorId={session?.user?.id ?? ''}
    />
  );
}
