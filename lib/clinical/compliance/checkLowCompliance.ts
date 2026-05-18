import 'server-only';

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

  // Walk every patient with an assigned therapist + at least one active
  // home-program item. Patients without active programs can't have low
  // compliance — calculateCompliance returns rate=null for them.
  const profiles = await db.patientProfile.findMany({
    where: { assignedTherapistId: { not: null } },
    select: {
      userId: true,
      assignedTherapistId: true,
      user: { select: { fullNameEn: true, fullNameAr: true, deletedAt: true } },
    },
  });

  const cooldownCutoff = new Date(now);
  cooldownCutoff.setUTCDate(cooldownCutoff.getUTCDate() - cooldownDays);

  let notificationsCreated = 0;
  let notificationsSkippedByCooldown = 0;
  let patientsChecked = 0;

  for (const profile of profiles) {
    if (!profile.assignedTherapistId) continue;
    if (profile.user.deletedAt) continue;
    patientsChecked += 1;

    const result = await calculateCompliance({
      patientId: profile.userId,
      windowDays: 7,
      now,
    });
    if (result.rate === null || result.rate >= threshold) continue;

    // Cooldown check — has any LOW_COMPLIANCE notification for this
    // (recipient, patient) pair been created in the last N days?
    const recent = await db.notification.findFirst({
      where: {
        recipientId: profile.assignedTherapistId,
        type: 'LOW_COMPLIANCE',
        relatedEntityType: 'User',
        relatedEntityId: profile.userId,
        createdAt: { gte: cooldownCutoff },
      },
      select: { id: true },
    });
    if (recent) {
      notificationsSkippedByCooldown += 1;
      continue;
    }

    await createNotification({
      recipientId: profile.assignedTherapistId,
      type: 'LOW_COMPLIANCE',
      params: {
        patientName: profile.user.fullNameEn,
        rate: Math.round(result.rate * 100).toString(),
      },
      linkPath: `/therapist/patients/${profile.userId}`,
      relatedEntityType: 'User',
      relatedEntityId: profile.userId,
    }).catch((err: unknown) => {
      console.error('[low-compliance] notification fan-out failed', err);
    });
    notificationsCreated += 1;
  }

  return { patientsChecked, notificationsCreated, notificationsSkippedByCooldown };
}
