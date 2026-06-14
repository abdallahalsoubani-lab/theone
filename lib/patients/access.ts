import { auth } from '@/auth';
import { ForbiddenError } from '@/lib/rbac/guards';

import { isClinicianAssignedTo } from './assignment';

/**
 * Patient-file access gate.
 *
 * Secretary and Admin see every patient. Doctor and Therapist see only
 * patients where they are a member of the care team (any therapist or
 * doctor slot). Patient sees only themselves (their own portal pages, not
 * the file).
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

/**
 * Staff-only clinical-read gate (Prompt 22 §2). Same shape as
 * `ensureCanReadPatient` MINUS the patient self-read branch — used by the
 * clinical report downloads (session report, treatment plan) which are a staff
 * surface: SECRETARY/ADMIN any patient, DOCTOR/THERAPIST only assigned, and the
 * patient portal has no access. Throws ForbiddenError otherwise.
 */
export async function ensureCanReadPatientStaff(patientId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new ForbiddenError();
  const role = session.user.role;
  if (role === 'ADMIN' || role === 'SECRETARY') return;
  if (role === 'DOCTOR' || role === 'THERAPIST') {
    const ok = await isClinicianAssignedTo(session.user.id, patientId);
    if (!ok) throw new ForbiddenError();
    return;
  }
  throw new ForbiddenError();
}

/**
 * Patient phone-number visibility (Prompt 15 §1).
 *
 * A patient's phone is contact PII visible ONLY to SECRETARY and ADMIN, and
 * to the patient themself (their own portal/profile). THERAPIST and DOCTOR
 * must never see it. This is the single source of truth for that rule; the
 * patient read queries (`getPatientFile`, the appointment side-panel query,
 * the PDF export) call it and null the phone out at the data layer so it is
 * never serialized to a clinician's session.
 *
 * Fail-closed: with no session, or any role other than the above, returns
 * false. Server-side senders (WhatsApp jobs, reminder workers) read the phone
 * directly from Prisma without a viewer session and are intentionally not
 * routed through here.
 */
export async function viewerCanSeePatientPhone(patientId?: string): Promise<boolean> {
  const session = await auth();
  const user = session?.user;
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'SECRETARY') return true;
  if (user.role === 'PATIENT' && patientId !== undefined && user.id === patientId) return true;
  return false;
}
