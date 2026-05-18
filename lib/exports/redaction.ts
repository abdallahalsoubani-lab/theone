import { can, type PermissionUser } from '@/lib/rbac/can';

/**
 * Redaction level for the patient-file PDF export (Prompt 11 §4.3).
 *
 *   SELF      — patient exporting their own file. Profile + intake
 *               responses + appointments + home program. No clinical
 *               assessments or session notes.
 *   CLINICAL  — clinical staff with patient read access. Adds
 *               treatment plans + session note count.
 *   ADMIN     — Admin role. Adds an audit summary.
 *
 * Extracted into its own module so the redaction logic stays pure /
 * import-light — the PDF builder pulls in @react-pdf/renderer + Prisma,
 * but the access check should be testable in isolation.
 */
export type ExportRedaction = 'SELF' | 'CLINICAL' | 'ADMIN';

export function resolveRedaction(
  requester: PermissionUser,
  patientId: string,
): ExportRedaction | null {
  if (requester.role === 'PATIENT' && requester.id === patientId) return 'SELF';
  if (requester.role === 'ADMIN') return 'ADMIN';
  if (
    requester.role === 'DOCTOR' ||
    requester.role === 'THERAPIST' ||
    requester.role === 'SECRETARY'
  ) {
    return 'CLINICAL';
  }
  if (can(requester, 'patients.read')) return 'CLINICAL';
  return null;
}
