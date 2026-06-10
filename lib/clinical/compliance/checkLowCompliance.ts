// Note: this module is intentionally NOT marked `server-only` — it is
// consumed both by the BullMQ workers process (pure Node, no Next.js
// bundler) and by server actions. The `server-only` marker would crash
// the worker at import time because tsx doesn't run the Next.js bundler
// that swaps the marker for a no-op.

import { CareTeamRole } from '@prisma/client';

import { db } from '@/lib/db';
import { createNotification } from '@/lib/notifications/actions';

import { calculateCompliance } from './calculate';

/**
 * Daily low-compliance scan (Prompt 10 §4.8.3).
 *
 * For every Therapist's assigned patients, compute 7-day compliance.
 * When `rate < threshold`, emit a LOW_COMPLIANCE notification to the
 * Therapist — but only if no LOW_COMPLIANCE notification for the same
 * patient has been created in the last `cooldownDays` days.
 *
 * Cooldown defends against spam: a patient who falls below the line
 * stays below it day-over-day, so without the cooldown the Therapist
 * gets a fresh notification every morning until the patient catches
 * up. Three days is the spec default; admin can tune in env later.
 *
 * The scan is intentionally fan-out style — one query per patient —
 * at clinic scale this is fine (50-100 patients per therapist). A
 * SQL aggregation would be cheaper but harder to maintain.
 */

export interface LowComplianceCheckArgs {
  /** Defaults to 0.5 (50%). */
  threshold?: number;
  /** Defaults to 3. */
  cooldownDays?: number;
  /** Override for tests — defaults to now. */
  now?: Date;
}

export interface LowComplianceCheckResult {
  patientsChecked: number;
  notificationsCreated: number;
  notificationsSkippedByCooldown: number;
}

const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_COOLDOWN_DAYS = 3;

export async function runLowComplianceCheck(
  args: LowComplianceCheckArgs = {},
): Promise<LowComplianceCheckResult> {
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;
  const cooldownDays = args.cooldownDays ?? DEFAULT_COOLDOWN_DAYS;
  const now = args.now ?? new Date();

  // Walk every (therapist → patient) care-team link. A patient with two
  // therapists is checked once per therapist so each gets nudged. Patients
  // without active programs can't have low compliance — calculateCompliance
  // returns rate=null for them.
  const memberships = await db.careTeamMember.findMany({
    where: { role: CareTeamRole.THERAPIST },
    select: {
      clinicianId: true,
      patientId: true,
      patient: { select: { user: { select: { fullNameEn: true, deletedAt: true } } } },
    },
  });

  const cooldownCutoff = new Date(now);
  cooldownCutoff.setUTCDate(cooldownCutoff.getUTCDate() - cooldownDays);

  let notificationsCreated = 0;
  let notificationsSkippedByCooldown = 0;
  const checkedPatients = new Set<string>();
  // Memoize compliance per patient so a multi-therapist patient is computed once.
  const complianceCache = new Map<string, number | null>();

  for (const membership of memberships) {
    if (membership.patient.user.deletedAt) continue;
    checkedPatients.add(membership.patientId);

    let rate = complianceCache.get(membership.patientId);
    if (rate === undefined) {
      rate = (await calculateCompliance({ patientId: membership.patientId, windowDays: 7, now }))
        .rate;
      complianceCache.set(membership.patientId, rate);
    }
    if (rate === null || rate >= threshold) continue;

    // Cooldown check — has any LOW_COMPLIANCE notification for this
    // (recipient, patient) pair been created in the last N days?
    const recent = await db.notification.findFirst({
      where: {
        recipientId: membership.clinicianId,
        type: 'LOW_COMPLIANCE',
        relatedEntityType: 'User',
        relatedEntityId: membership.patientId,
        createdAt: { gte: cooldownCutoff },
      },
      select: { id: true },
    });
    if (recent) {
      notificationsSkippedByCooldown += 1;
      continue;
    }

    await createNotification({
      recipientId: membership.clinicianId,
      type: 'LOW_COMPLIANCE',
      params: {
        patientName: membership.patient.user.fullNameEn,
        rate: Math.round(rate * 100).toString(),
      },
      linkPath: `/therapist/patients/${membership.patientId}`,
      relatedEntityType: 'User',
      relatedEntityId: membership.patientId,
    }).catch((err: unknown) => {
      console.error('[low-compliance] notification fan-out failed', err);
    });
    notificationsCreated += 1;
  }

  return {
    patientsChecked: checkedPatients.size,
    notificationsCreated,
    notificationsSkippedByCooldown,
  };
}
