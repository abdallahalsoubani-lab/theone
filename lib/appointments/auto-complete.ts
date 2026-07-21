import { AppointmentStatus, AuditAction } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

/**
 * Auto-complete a session at its scheduled end (July change request #4).
 *
 * Reverses the Prompt-22 §4.4 "manual End Session only, no auto-complete"
 * decision — clinic-approved: sessions now finish on their own with zero
 * grace, and the manual "End session" buttons are removed.
 *
 * Safety rules (do NOT mark a session done that didn't happen):
 *   - completes ONLY an `IN_PROGRESS` (actually checked-in) session;
 *   - `SCHEDULED` / `CONFIRMED` (patient never checked in) are left untouched
 *     — a no-show is a separate, explicit action;
 *   - already `COMPLETED` / `CANCELLED` / `NO_SHOW` → no-op (idempotent).
 *
 * The guarded `updateMany` (status = IN_PROGRESS in the WHERE) makes the
 * transition atomic, so a concurrent cancel/no-show can never be overwritten.
 *
 * Status change only: the SOAP note is still owed and continues to surface via
 * `listAppointmentsPendingNote` (COMPLETED-without-note). Audited with the
 * seeded SYSTEM user as actor (the job has no session).
 */
export const autoCompleteSession = withAudit<[string], { completed: boolean }>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0],
    extractAfter: (result) => ({
      event: 'SESSION_AUTO_COMPLETED',
      applied: result.completed,
    }),
    actorOverride: async () => SYSTEM_USER_ID,
  },
  async function autoCompleteInner(appointmentId): Promise<{ completed: boolean }> {
    const res = await db.appointment.updateMany({
      where: { id: appointmentId, status: AppointmentStatus.IN_PROGRESS },
      data: { status: AppointmentStatus.COMPLETED },
    });
    return { completed: res.count > 0 };
  },
);
