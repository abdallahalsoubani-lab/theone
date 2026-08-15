import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { auth } from '@/auth';
import { PatientHomeProgramTab } from '@/components/home-program/PatientHomeProgramTab';
import { PatientAppointmentsTab } from '@/components/patients/PatientAppointmentsTab';
import { PatientDocumentsTab } from '@/components/patients/PatientDocumentsTab';
import { PatientFilePage } from '@/components/patients/PatientFilePage';
import { listAppointmentsForPatientFile } from '@/lib/appointments/queries';
import { listDocuments } from '@/lib/patient-documents/queries';
import { getPatientHomeProgramTabData } from '@/lib/clinical/home-program/patient-tab';
import { getPatientPlanState } from '@/lib/clinical/plans/queries';
import {
  listReportableAppointmentsForPatient,
  listSessionNotesForPatient,
} from '@/lib/clinical/session-notes/queries';
import { getPatientTimeline } from '@/lib/clinical/timeline/query';
import { listIntakesForPatient } from '@/lib/intake/queries';
import { ensureCanReadPatient } from '@/lib/patients/access';
import { hasCompletedDoctorVisit } from '@/lib/patients/first-visit';
import { bookDoctorVisitHref } from '@/lib/patients/first-visit-policy';
import { getPatientFile } from '@/lib/patients/queries';
import { listPatientActivity } from '@/lib/patients/queries-audit';
import { requirePermission } from '@/lib/rbac/guards';

const TIMELINE_PAGE_SIZE = 25;

/**
 * Admin patient file (Prompt 33 — A-19). Before this route existed, every
 * cross-role surface (calendar side panel, etc.) sent Admins to the
 * SECRETARY patient page, silently swapping their sidebar and navigation for
 * the Secretary interface. Same shared PatientFilePage as the other roles,
 * admin basePath. Edit/reset were deliberately read-only at A-19; the owner
 * reversed that on Aug 1 — the Admin now adds/edits patients from their own
 * shell (/admin/patients list + new + edit, same shared forms).
 */
export default async function AdminPatientFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requirePermission('patients.read');
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
    reportableAppointments,
    timeline,
    homeProgramData,
    documents,
  ] = await Promise.all([
    getPatientFile(id),
    listPatientActivity(id),
    listIntakesForPatient(id),
    getPatientPlanState(id),
    listSessionNotesForPatient(id),
    listReportableAppointmentsForPatient(id),
    getPatientTimeline(
      id,
      {
        search: sp.q,
        from: sp.from ? new Date(sp.from) : undefined,
        to: sp.to ? new Date(sp.to) : undefined,
      },
      { page: timelinePage, pageSize: TIMELINE_PAGE_SIZE },
      'ADMIN',
    ),
    getPatientHomeProgramTabData(id),
    listDocuments(id),
  ]);
  if (!patient) notFound();
  const fileAppointments = await listAppointmentsForPatientFile(id);
  // NI-5 (Prompt 41, soft): derived flag + doctor-scoped booking deep link
  // into the ADMIN calendar (A-19 — stay in the admin shell).
  const pendingFirstVisit = !(await hasCompletedDoctorVisit(id));
  return (
    <PatientFilePage
      patient={patient}
      pendingFirstVisit={pendingFirstVisit}
      bookDoctorHref={bookDoctorVisitHref('ADMIN', id, pendingFirstVisit)}
      appointments={
        <PatientAppointmentsTab
          appointments={fileAppointments}
          locale={locale === 'ar' ? 'ar' : 'en'}
          patientId={patient.id}
          canReschedule
        />
      }
      activity={activity}
      intakes={intakes}
      basePath="/admin/patients"
      canEdit
      canResetPassword
      locale={locale === 'ar' ? 'ar' : 'en'}
      planState={planState}
      notes={notes}
      reportableAppointments={reportableAppointments}
      timeline={timeline}
      timelinePage={timelinePage}
      timelinePageSize={TIMELINE_PAGE_SIZE}
      homeProgram={
        <PatientHomeProgramTab
          patientId={patient.id}
          items={homeProgramData.items}
          approval={homeProgramData.approval}
          draftItemCount={homeProgramData.draftItemCount}
          sevenDay={homeProgramData.sevenDay}
          thirtyDay={homeProgramData.thirtyDay}
          streak={homeProgramData.streak}
          lastCompletedById={homeProgramData.lastCompletedById}
          canEdit={false}
          locale={locale === 'ar' ? 'ar' : 'en'}
        />
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
            pediatricId: null,
            noteId: notes[0]?.id ?? null,
          }}
        />
      }
      viewerRole="ADMIN"
      actorId={session?.user?.id ?? ''}
    />
  );
}
