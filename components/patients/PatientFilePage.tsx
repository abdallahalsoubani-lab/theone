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
import type { SessionNoteRow } from '@/lib/clinical/session-notes/queries';
import type { TimelinePage } from '@/lib/clinical/timeline/types';
import type { IntakeListRow } from '@/lib/intake/queries';
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
  timeline?: TimelinePage;
  timelinePage?: number;
  timelinePageSize?: number;
  /**
   * Home program tab content (Prompt 10). Caller passes a pre-rendered
   * <PatientHomeProgramTab/> with the items + compliance data fetched
   * on the server.
   */
  homeProgram?: ReactNode;
  /** Pediatric assessment tab (Prompt 21). Passed only when the viewer can read it. */
  pediatric?: ReactNode;
  /** Documents + reports tab (Prompt 22). Passed only for staff viewers. */
  documents?: ReactNode;
  viewerRole?: 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'ADMIN' | 'PATIENT';
  actorId?: string;
}

/**
 * Shared patient-file renderer. Each role's route mounts this with the
 * appropriate basePath and the canEdit / canResetPassword flags computed
 * from the session role.
 */
export function PatientFilePage({
  patient,
  activity,
  intakes,
  basePath,
  canEdit,
  canResetPassword,
  locale,
  planState,
  notes,
  timeline,
  timelinePage = 1,
  timelinePageSize = 25,
  homeProgram,
  pediatric,
  documents,
  viewerRole,
  actorId,
}: Props) {
  return (
    <section className="space-y-6 p-6">
      <PatientHeader patient={patient} />
      <PatientFileTabs
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
