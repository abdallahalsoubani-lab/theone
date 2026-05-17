import { auth } from '@/auth';
import { ForbiddenError } from '@/lib/rbac/guards';

import { isClinicianAssignedTo } from './queries';

/**
 * Patient-file access gate.
 *
 * Secretary and Admin see every patient. Doctor and Therapist see only
 * patients where they are the assignedTherapist or responsibleDoctor.
 * Patient sees only themselves (their own portal pages, not the file).
 *
 * Throws ForbiddenError when the role match the URL prefix but the
 * relationship to the patient is missing — surfaced as a 403 by the
 * outer error boundary.
 */
export async function ensureCanReadPatient(patientId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new ForbiddenError();
  const role = session.user.role;
  if (role === 'ADMIN' || role === 'SECRETARY') return;
  if (role === 'DOCTOR' || role === 'THERAPIST') {
    const ok = await isClinicianAssignedTo(session.user.id, patientId);
    if (!ok) throw new ForbiddenError();
    return;
  }
  if (role === 'PATIENT' && session.user.id === patientId) return;
  throw new ForbiddenError();
}
