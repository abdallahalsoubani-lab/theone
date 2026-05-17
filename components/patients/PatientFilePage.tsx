import { PatientActivityTab } from '@/components/patients/PatientActivityTab';
import { PatientFileTabs } from '@/components/patients/PatientFileTabs';
import { PatientHeader } from '@/components/patients/PatientHeader';
import { PatientProfileTab } from '@/components/patients/PatientProfileTab';
import { ResetPasswordButton } from '@/components/patients/PatientFileShell';
import type { PatientFileData } from '@/lib/patients/queries';
import type { PatientActivityRow } from '@/lib/patients/queries-audit';

import { IntakeTabPlaceholder } from './IntakeTabPlaceholder';

interface Props {
  patient: PatientFileData;
  activity: PatientActivityRow[];
  basePath: string;
  canEdit: boolean;
  canResetPassword: boolean;
  locale: 'en' | 'ar';
}

/**
 * Shared patient-file renderer. Each role's route mounts this with the
 * appropriate basePath ('/secretary/patients' etc.) and the canEdit /
 * canResetPassword flags computed from the session role.
 */
export function PatientFilePage({
  patient,
  activity,
  basePath,
  canEdit,
  canResetPassword,
  locale,
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
          <IntakeTabPlaceholder patientId={patient.id} basePath={basePath} canCreate={canEdit} />
        }
        activity={<PatientActivityTab rows={activity} />}
      />
    </section>
  );
}
