import 'server-only';

import { HomeProgramStatus } from '@prisma/client';

import { db } from '@/lib/db';

import { listHomeProgramForPatient, type HomeProgramItemRow } from './queries';
import { parseSnapshot } from './visibility';

/**
 * THE approved-program read (data-layer guarantee, Prompt 16; PT-B2 item 1).
 *
 * Split out of `approval.ts` so the surfaces that only READ the program — the
 * patient portal, the patient-file tab, the patient-file PDF — don't pull in
 * the write side's dependency graph (`@/auth`, notifications, the audit
 * decorator). `approval.ts` owns the transitions; this owns the read.
 */

/**
 * The APPROVED content only: the live items while the program is APPROVED,
 * otherwise the frozen `approvedSnapshot` (the last approved content), or
 * nothing if the program was never approved. Never the raw
 * `listHomeProgramForPatient`, which is the clinicians' working draft.
 */
export async function getVisibleHomeProgram(patientId: string): Promise<HomeProgramItemRow[]> {
  const row = await db.homeProgramApproval.findUnique({
    where: { patientId },
    select: { status: true, approvedSnapshot: true },
  });
  if (!row) return [];
  if (row.status === HomeProgramStatus.APPROVED) return listHomeProgramForPatient(patientId);
  return parseSnapshot(row.approvedSnapshot);
}

/** Visible (approved) items scheduled for today. */
export async function getVisibleTodayItems(
  patientId: string,
  now: Date = new Date(),
): Promise<HomeProgramItemRow[]> {
  const dow = new Date(now).getUTCDay();
  const items = await getVisibleHomeProgram(patientId);
  return items.filter((i) => i.active && i.daysOfWeek.includes(dow));
}
