import { PatientPlanTab } from '@/components/clinical/PatientPlanTab';
import { PatientActivityTab } from '@/components/patients/PatientActivityTab';
import { PatientFileTabs } from '@/components/patients/PatientFileTabs';
import { PatientHeader } from '@/components/patients/PatientHeader';
import { PatientIntakeTab } from '@/components/patients/PatientIntakeTab';
import { PatientProfileTab } from '@/components/patients/PatientProfileTab';
import { ResetPasswordButton } from '@/components/patients/PatientFileShell';
import type { PatientPlanState } from '@/lib/clinical/plans/queries';
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
  viewerRole?: 'DOCTOR' | 'THERAPIST' | 'SECRETARY' | 'ADMIN' | 'PATIENT';
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
  viewerRole,
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
        activity={<PatientActivityTab rows={activity} />}
      />
    </section>
  );
}
