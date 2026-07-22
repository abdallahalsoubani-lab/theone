import { AppointmentStatus, UserRole } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Doctor-first-visit flag (Prompt 41 — NI-5, owner ruling: SOFT enforcement).
 *
 * DERIVED truth, never stored: a patient is "pending first visit" until they
 * have at least one COMPLETED appointment whose assigned clinicians
 * (AppointmentTherapist M2M) include a DOCTOR. Cancelled / no-show doctor
 * visits do NOT clear the flag; the normal clear path is the auto-complete
 * job (Prompt 25b) finishing the visit. No column, no migration, no sync
 * bugs, no manual override — by design.
 */

const completedDoctorVisitWhere = (patientId: { in: string[] } | string) => ({
  patientId,
  status: AppointmentStatus.COMPLETED,
  therapists: { some: { therapist: { role: UserRole.DOCTOR } } },
});

/** Has this patient completed their first doctor visit? */
export async function hasCompletedDoctorVisit(patientId: string): Promise<boolean> {
  const row = await db.appointment.findFirst({
    where: completedDoctorVisitWhere(patientId),
    select: { id: true },
  });
  return row !== null;
}

/**
 * Batch derivation for list pages — ONE query for the whole page, returning
 * the subset of `patientIds` that are still PENDING (no completed doctor
 * visit). Keeps the patients table free of per-row N+1.
 */
export async function pendingFirstVisitIds(patientIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(patientIds)].filter(Boolean);
  if (ids.length === 0) return new Set();
  const done = await db.appointment.findMany({
    where: completedDoctorVisitWhere({ in: ids }),
    select: { patientId: true },
    distinct: ['patientId'],
  });
  const doneSet = new Set(done.map((r) => r.patientId));
  return new Set(ids.filter((id) => !doneSet.has(id)));
}
