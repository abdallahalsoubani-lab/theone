import type { ReactNode } from 'react';

import { PatientNotesTab } from '@/components/clinical/PatientNotesTab';
import { PatientPlanTab } from '@/components/clinical/PatientPlanTab';
import { PatientTimelineTab } from '@/components/clinical/PatientTimelineTab';
import { PatientActivityTab } from '@/components/patients/PatientActivityTab';
import { PatientFileTabs } from '@/components/patients/PatientFileTabs';
import { PatientHeader } from '@/components/patients/PatientHeader';
import { PatientIntakeTab } from '@/components/patients/PatientIntakeTab';
import { PatientProfileTab } from '@/components/patients/PatientProfileTab';
import { ResetPasswordButton } from '@/components/patients/PatientFileShell';
import type { PatientPlanState } from '@/lib/clinical/plans/queries';
import type {
  ReportableAppointmentRow,
  SessionNoteRow,
} from '@/lib/clinical/session-notes/queries';
import type { TimelinePage } from '@/lib/clinical/timeline/types';
import type { IntakeListRow } from '@/lib/intake/queries';
import type { IntakeLinkCardData } from '@/components/patients/IntakeLinkCard';
import type { PatientFileData } from '@/lib/patients/queries';
import type { PatientActivityRow } from '@/lib/patients/queries-audit';

interface Props {
  patient: PatientFileData;
  activity: PatientActivityRow[];
  intakes: IntakeListRow[];
  basePath: string;
  canEdit: boolean;
  canResetPassword: boolean;
  locale: 'en' | 'ar';
  planState?: PatientPlanState;
  notes?: SessionNoteRow[];
  /** Prompt 46 row 5 — finished sessions still missing their report
   *  (authoring pages pass it; the Notes tab renders the add-report rows). */
  reportableAppointments?: ReportableAppointmentRow[];
  timeline?: TimelinePage;
  timelinePage?: number;
  timelinePageSize?: number;
  /**
   * Home program tab content (Prompt 10). Caller passes a pre-rendered
   * <PatientHomeProgramTab/> with the items + compliance data fetched
   * on the server.
   */
  appointments?: ReactNode;
  homeProgram?: ReactNode;
  /** Pediatric assessment tab (Prompt 21). Passed only when the viewer can read it. */
  pediatric?: ReactNode;
  /** Documents + reports tab (Prompt 22). Passed only for staff viewers. */
  documents?: ReactNode;
  viewerRole?: 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'ADMIN' | 'PATIENT';
  actorId?: string;
  /** P52 — the personal intake-link panel data (SECRETARY/ADMIN pages only). */
  intakeLink?: IntakeLinkCardData;
  /** NI-5 (Prompt 41): derived pending-first-visit flag + optional CTA href. */
  pendingFirstVisit?: boolean;
  bookDoctorHref?: string | null;
}

/**
 * Shared patient-file renderer. Each role's route mounts this with the
 * appropriate basePath and the canEdit / canResetPassword flags computed
 * from the session role.
 */
export async function PatientFilePage({
  patient,
  activity,
  intakes,
  basePath,
  canEdit,
  canResetPassword,
  locale,
  planState,
  notes,
  reportableAppointments,
  timeline,
  timelinePage = 1,
  timelinePageSize = 25,
  appointments,
  homeProgram,
  pediatric,
  documents,
  viewerRole,
  intakeLink,
  actorId,
  pendingFirstVisit = false,
  bookDoctorHref = null,
}: Props) {
  // A-20 (Prompt 39 addendum — owner ruling): patient accounts are NOT
  // impersonatable, and this page's subject is always a patient, so the
  // Act-As entry point is gone for good (the server action rejects patient
  // targets too — canActAsTarget). Staff impersonation lives in /admin/users.
  const showActAs = false;
  return (
    <section className="space-y-6 p-6">
      <PatientHeader
        patient={patient}
        showActAs={showActAs}
        pendingFirstVisit={pendingFirstVisit}
        bookDoctorHref={bookDoctorHref}
      />
      <PatientFileTabs
        appointments={appointments}
        profile={
          <PatientProfileTab
            patient={patient}
            locale={locale}
            canEdit={canEdit}
            canResetPassword={canResetPassword}
            basePath={basePath}
            resetTrigger={canResetPassword ? <ResetPasswordButton patientId={patient.id} /> : null}
          />
        }
        intake={
          <PatientIntakeTab
            patientId={patient.id}
            rows={intakes}
            basePath={basePath}
            canCreate={canEdit}
            intakeLink={canEdit ? intakeLink : undefined}
          />
        }
        plan={
          planState ? (
            <PatientPlanTab
              state={planState}
              patientId={patient.id}
              viewerRole={viewerRole ?? 'SECRETARY'}
            />
          ) : undefined
        }
        notes={
          notes ? (
            <PatientNotesTab
              notes={notes}
              viewerRole={viewerRole ?? 'SECRETARY'}
              actorId={actorId ?? ''}
              locale={locale}
              addable={reportableAppointments}
            />
          ) : undefined
        }
        timeline={
          timeline ? (
            <PatientTimelineTab
              entries={timeline.entries}
              total={timeline.total}
              page={timelinePage}
              pageSize={timelinePageSize}
            />
          ) : undefined
        }
        homeProgram={homeProgram}
        pediatric={pediatric}
        documents={documents}
        activity={<PatientActivityTab rows={activity} />}
      />
    </section>
  );
}
