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
  /**
   * Optional plan state — populated when the caller has fetched it.
   * When omitted the Plan tab falls back to its placeholder copy.
   */
  planState?: PatientPlanState;
  /** Optional session-notes list. When omitted the Notes tab falls back. */
  notes?: SessionNoteRow[];
  /** Optional timeline page. When omitted the Timeline tab falls back. */
  timeline?: TimelinePage;
  timelinePage?: number;
  timelinePageSize?: number;
  viewerRole?: 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'ADMIN' | 'PATIENT';
  /** Current actor id — needed for the notes tab's author gating. */
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
        activity={<PatientActivityTab rows={activity} />}
      />
    </section>
  );
}
