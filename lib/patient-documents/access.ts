import { auth } from '@/auth';
import { isClinicianAssignedTo } from '@/lib/patients/assignment';
import { ForbiddenError } from '@/lib/rbac/guards';

/**
 * Document access gate (Prompt 22). Documents follow patient-file visibility —
 * SECRETARY/ADMIN see all; DOCTOR/THERAPIST only their assigned patients —
 * EXCEPT the patient portal: a patient cannot access these internal clinical
 * attachments. Throws ForbiddenError (→ 403) otherwise.
 */
export async function ensureCanAccessPatientDocuments(
  patientId: string,
): Promise<{ id: string; role: string }> {
  const session = await auth();
  if (!session?.user) throw new ForbiddenError();
  const { id, role } = session.user;
  if (role === 'ADMIN' || role === 'SECRETARY') return { id, role };
  if (role === 'DOCTOR' || role === 'THERAPIST') {
    const ok = await isClinicianAssignedTo(id, patientId);
    if (!ok) throw new ForbiddenError();
    return { id, role };
  }
  throw new ForbiddenError();
}
