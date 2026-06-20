import { AppointmentStatus, AuditAction } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

import { getSessionGraceConfig } from './session-settings';
import { isSessionOverdue } from './session-timing';

/**
 * Overdue-session auto-completion (Fix Prompt 2 — Receptionist #21).
 *
 * A session left open (IN_PROGRESS) past `appointment_end + grace` is closed by
 * the maintenance worker, independent of anyone opening a page. Each closure is
 * audited as the reserved `system` actor (SESSION_AUTO_COMPLETED) so it is
 * distinguishable from a manual end.
 *
 * Safety / idempotency:
 *   - Only IN_PROGRESS rows are scanned — cancelled / no-show / already-
 *     completed are never touched.
 *   - The status flip is a guarded `updateMany(where: { id, IN_PROGRESS })`, so
 *     a second tick (or a concurrent manual end) that already moved the row
 *     matches zero rows and writes no duplicate audit entry.
 */

/** Sentinel: the row was no longer IN_PROGRESS when we tried to close it. */
class AlreadyHandled extends Error {}

const autoCompleteOne = withAudit<[{ id: string }], { appointmentId: string }>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    actorOverride: async () => SYSTEM_USER_ID,
    extractAfter: () => ({ event: 'SESSION_AUTO_COMPLETED' }),
  },
  async function inner({ id }): Promise<{ appointmentId: string }> {
    const res = await db.appointment.updateMany({
      where: { id, status: AppointmentStatus.IN_PROGRESS },
      data: { status: AppointmentStatus.COMPLETED },
    });
    // No row moved → already ended/cancelled by someone else. Throw so withAudit
    // (no-op on throw) writes no audit row; the caller swallows this sentinel.
    if (res.count === 0) throw new AlreadyHandled();
    return { appointmentId: id };
  },
);

export interface AutoCompleteSummary {
  scanned: number;
  completed: number;
}

/**
 * Find IN_PROGRESS sessions past their grace threshold and complete them.
 * `now` is injectable for tests; defaults to the current instant.
 */
export async function autoCompleteOverdueSessions(
  now: Date = new Date(),
): Promise<AutoCompleteSummary> {
  const { autoCompleteGraceMinutes } = await getSessionGraceConfig();

  const open = await db.appointment.findMany({
    where: { status: AppointmentStatus.IN_PROGRESS },
    select: { id: true, startsAt: true, durationMinutes: true },
  });

  let completed = 0;
  for (const appt of open) {
    if (!isSessionOverdue(now, appt.startsAt, appt.durationMinutes, autoCompleteGraceMinutes)) {
      continue;
    }
    try {
      await autoCompleteOne({ id: appt.id });
      completed += 1;
    } catch (err) {
      if (err instanceof AlreadyHandled) continue;
      throw err;
    }
  }

  return { scanned: open.length, completed };
}
