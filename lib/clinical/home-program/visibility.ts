// NOT `server-only`: imported by the BullMQ workers (home reminder + daily
// compliance) which run in plain Node, outside the Next bundler — same reason
// lib/clinical/compliance/checkLowCompliance.ts avoids the marker. Keep this
// module dependency-light (db only): no `@/auth`, no notifications.

import { HomeProgramStatus, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { HomeProgramItemRow } from './queries';

export interface ApprovalState {
  status: HomeProgramStatus;
  remindersEnabled: boolean;
  changesComment: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  approvedAt: Date | null;
}

const DEFAULT_STATE: ApprovalState = {
  status: HomeProgramStatus.DRAFT,
  remindersEnabled: true,
  changesComment: null,
  submittedAt: null,
  reviewedAt: null,
  approvedAt: null,
};

/** Current approval state for a patient (defaults to DRAFT when no row yet). */
export async function getApprovalState(patientId: string): Promise<ApprovalState> {
  const row = await db.homeProgramApproval.findUnique({ where: { patientId } });
  if (!row) return DEFAULT_STATE;
  return {
    status: row.status,
    remindersEnabled: row.remindersEnabled,
    changesComment: row.changesComment,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    approvedAt: row.approvedAt,
  };
}

/** True when the patient's program is APPROVED (patient-visible / compliable). */
export async function programApproved(patientId: string): Promise<boolean> {
  const row = await db.homeProgramApproval.findUnique({
    where: { patientId },
    select: { status: true },
  });
  return row?.status === HomeProgramStatus.APPROVED;
}

/** True when the patient may receive WhatsApp reminders right now
 *  (APPROVED AND the delivery preference is on). */
export async function remindersActive(patientId: string): Promise<boolean> {
  const row = await db.homeProgramApproval.findUnique({
    where: { patientId },
    select: { status: true, remindersEnabled: true },
  });
  return row?.status === HomeProgramStatus.APPROVED && row.remindersEnabled;
}

/** Parse a stored snapshot back into HomeProgramItemRow[] (createdAt → Date). */
export function parseSnapshot(snapshot: Prisma.JsonValue | null): HomeProgramItemRow[] {
  if (!Array.isArray(snapshot)) return [];
  return (snapshot as unknown as Array<HomeProgramItemRow & { createdAt: string }>).map((i) => ({
    ...i,
    createdAt: new Date(i.createdAt),
  }));
}
