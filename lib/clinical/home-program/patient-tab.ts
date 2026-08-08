import 'server-only';

import {
  calculateCompliance,
  calculateStreak,
  type ComplianceResult,
} from '@/lib/clinical/compliance/calculate';
import { db } from '@/lib/db';

import { getVisibleHomeProgram } from './visible';
import { listHomeProgramForPatient, type HomeProgramItemRow } from './queries';
import { getApprovalState, type ApprovalState } from './visibility';

/**
 * Server-side helper for the patient-file Home Program tab. Bundles
 * everything the tab renders (items + 7d/30d compliance + streak +
 * last-completed map) into one call so the page-level `Promise.all`
 * stays tidy.
 *
 * `items` is the APPROVED program — what the patient is actually told to do
 * (PT-B2 item 1). A therapist's unsubmitted draft is NOT the patient's
 * program, so it must never render here as if it were; the tab shows the
 * approval status plus `draftItemCount` instead, and the builder (behind the
 * Edit link) remains the place to see the working draft.
 */
export interface PatientHomeProgramTabData {
  /** The approved program only — `getVisibleHomeProgram`, never the raw draft. */
  items: HomeProgramItemRow[];
  approval: ApprovalState;
  /** Items in the clinicians' working draft — drives the "revision pending" note. */
  draftItemCount: number;
  sevenDay: ComplianceResult;
  thirtyDay: ComplianceResult;
  streak: number;
  lastCompletedById: Map<string, Date>;
}

export async function getPatientHomeProgramTabData(
  patientId: string,
  now: Date = new Date(),
): Promise<PatientHomeProgramTabData> {
  const since30d = new Date(now);
  since30d.setUTCHours(0, 0, 0, 0);
  since30d.setUTCDate(since30d.getUTCDate() - 30);

  const [items, approval, draftItems, sevenDay, thirtyDay, streak, completions] = await Promise.all(
    [
      getVisibleHomeProgram(patientId),
      getApprovalState(patientId),
      listHomeProgramForPatient(patientId),
      calculateCompliance({ patientId, windowDays: 7, now }),
      calculateCompliance({ patientId, windowDays: 30, now }),
      calculateStreak({ patientId, now }),
      db.homeProgramCompletion.findMany({
        where: {
          item: { patientId },
          scheduledDate: { gte: since30d },
          completedAt: { not: null },
        },
        orderBy: { completedAt: 'desc' },
        select: { itemId: true, completedAt: true },
      }),
    ],
  );

  const lastCompletedById = new Map<string, Date>();
  for (const c of completions) {
    if (!c.completedAt) continue;
    if (!lastCompletedById.has(c.itemId)) {
      lastCompletedById.set(c.itemId, c.completedAt);
    }
  }

  return {
    items,
    approval,
    draftItemCount: draftItems.length,
    sevenDay,
    thirtyDay,
    streak,
    lastCompletedById,
  };
}
