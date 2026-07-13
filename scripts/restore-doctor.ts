#!/usr/bin/env tsx
/**
 * Prompt 22 Part 1 — restore the production Doctor account.
 *
 * What actually happened (established from the production AuditLog, entry of
 * 2026-07-04 11:53:15 UTC): the clinic's only DOCTOR user
 * `seed-user-doctor-sara` (Dr. Sara Al-Khatib · dr.sara@theone.pt ·
 * +962790000002) was never deleted — it was EDITED in the admin panel into
 * THERAPIST "Rana Adeeb". The doctor login effectively vanished while the row
 * itself lives on under a different identity.
 *
 * This script therefore restores by *splitting* the account, idempotently:
 *
 *   1. If the row is occupied by a different identity, first preserve that
 *      occupant: create (or reuse, matched by email) a THERAPIST user carrying
 *      the occupant's identity, copy specialty assignments, and re-point any
 *      therapist-side rows created after the repurpose timestamp to the new
 *      user. (As of 2026-07-13 production has ZERO rows referencing the
 *      account, so this is a safety net, not a data move.)
 *   2. Restore `seed-user-doctor-sara` to the audit-recorded original
 *      identity, keeping the SAME user id so every historical FK (none today,
 *      but any future restore-run) stays attached to the doctor.
 *
 *   - `passwordHash` is cleared on the restored account: the occupant's
 *     password must not open the doctor login. Run
 *     `scripts/reset-staff-passwords.ts --apply` right after (Part 1 §3 resets
 *     every staff password anyway).
 *   - AuditLog rows (actor `system`) record both mutations; payloads carry no
 *     password material. AuditLog history is append-only and is NOT rewritten:
 *     rows the occupant created while holding the account keep their actorId.
 *
 * Usage (on the VM):
 *   pnpm dotenv -e .env.local -- tsx scripts/restore-doctor.ts            # dry-run
 *   pnpm dotenv -e .env.local -- tsx scripts/restore-doctor.ts --apply
 */

import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const DOCTOR_ID = 'seed-user-doctor-sara';
/** The moment the account was repurposed — from the production AuditLog. */
const REPURPOSED_AT = new Date('2026-07-04T11:53:15.112Z');
/** Identity recorded in AuditLog.before of that entry. */
const ORIGINAL = {
  role: 'DOCTOR',
  email: 'dr.sara@theone.pt',
  phone: '+962790000002',
  fullNameEn: 'Dr. Sara Al-Khatib',
  fullNameAr: 'د. سارة الخطيب',
} as const;

const apply = process.argv.includes('--apply');

function log(line: string): void {
  console.warn(`[restore-doctor]${apply ? '' : ' (dry-run)'} ${line}`);
}

/** Every relation that can reference the doctor account — counted for the report. */
async function referenceCounts(userId: string): Promise<Array<[string, number]>> {
  const entries: Array<[string, Promise<number>]> = [
    ['TreatmentPlan.doctorId', db.treatmentPlan.count({ where: { doctorId: userId } })],
    [
      'TreatmentPlan.assignedTherapistId',
      db.treatmentPlan.count({ where: { assignedTherapistId: userId } }),
    ],
    ['CareTeamMember.clinicianId', db.careTeamMember.count({ where: { clinicianId: userId } })],
    [
      'IntakeAssessment.assessedById',
      db.intakeAssessment.count({ where: { assessedById: userId } }),
    ],
    [
      'IntakeAssessment.reviewedByClinicianId',
      db.intakeAssessment.count({ where: { reviewedByClinicianId: userId } }),
    ],
    ['SessionNote.therapistId', db.sessionNote.count({ where: { therapistId: userId } })],
    [
      'AppointmentTherapist.therapistId',
      db.appointmentTherapist.count({ where: { therapistId: userId } }),
    ],
    ['Appointment.createdById', db.appointment.count({ where: { createdById: userId } })],
    ['Appointment.cancelledById', db.appointment.count({ where: { cancelledById: userId } })],
    [
      'HomeProgramApproval.submittedById',
      db.homeProgramApproval.count({ where: { submittedById: userId } }),
    ],
    [
      'HomeProgramApproval.reviewedById',
      db.homeProgramApproval.count({ where: { reviewedById: userId } }),
    ],
    ['AuditLog.actorId', db.auditLog.count({ where: { actorId: userId } })],
    ['Notification.recipientId', db.notification.count({ where: { recipientId: userId } })],
    ['Leave.userId', db.leave.count({ where: { userId } })],
    ['DayReport.therapistId', db.dayReport.count({ where: { therapistId: userId } })],
  ];
  return Promise.all(entries.map(async ([label, p]) => [label, await p] as [string, number]));
}

async function systemActorId(): Promise<string> {
  const system = await db.user.findUnique({ where: { id: 'system' }, select: { id: true } });
  if (system) return system.id;
  const admin = await db.user.findFirst({
    where: { role: 'ADMIN', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) throw new Error('no system/admin actor found for audit rows');
  return admin.id;
}

async function main(): Promise<void> {
  const row = await db.user.findUnique({ where: { id: DOCTOR_ID } });
  const counts = await referenceCounts(DOCTOR_ID);
  log(`reference counts for ${DOCTOR_ID}:`);
  for (const [label, n] of counts) log(`  ${label.padEnd(40)} ${n}`);

  const actorId = await systemActorId();

  if (!row) {
    // Hard-delete case (not what production shows, but the script covers it):
    // recreate with the same id so any orphaned FKs re-attach.
    log(`user ${DOCTOR_ID} not found — would recreate with original identity (same id)`);
    if (apply) {
      await db.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: DOCTOR_ID,
            ...ORIGINAL,
            languagePref: 'EN',
            mustChangePassword: false,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            entityType: 'User',
            entityId: DOCTOR_ID,
            action: 'CREATE',
            after: { ...ORIGINAL, restoredBy: 'scripts/restore-doctor.ts' },
          },
        });
      });
      log('recreated doctor account (hard-delete path)');
    }
    return;
  }

  if (row.role === 'DOCTOR' && row.email === ORIGINAL.email) {
    log('doctor account already carries the original identity — nothing to do');
    return;
  }

  // Repurposed path: the row belongs to someone else right now.
  const occupant = {
    role: row.role,
    email: row.email,
    phone: row.phone,
    fullNameEn: row.fullNameEn,
    fullNameAr: row.fullNameAr,
    languagePref: row.languagePref,
    passwordHash: row.passwordHash,
    whatsappReachable: row.whatsappReachable,
  };
  log(`account currently held by "${occupant.fullNameEn}" <${occupant.email}> (${occupant.role})`);

  const existingOccupantUser = occupant.email
    ? await db.user.findFirst({
        where: { email: occupant.email, deletedAt: null, id: { not: DOCTOR_ID } },
        select: { id: true, fullNameEn: true },
      })
    : null;

  const specialties = await db.userSpecialty.findMany({ where: { userId: DOCTOR_ID } });
  const movable = {
    sessionNotes: await db.sessionNote.count({
      where: { therapistId: DOCTOR_ID, createdAt: { gte: REPURPOSED_AT } },
    }),
    appointmentTherapists: await db.appointmentTherapist.count({
      where: { therapistId: DOCTOR_ID, appointment: { createdAt: { gte: REPURPOSED_AT } } },
    }),
    careTeam: await db.careTeamMember.count({
      where: { clinicianId: DOCTOR_ID, assignedAt: { gte: REPURPOSED_AT } },
    }),
    dayReports: await db.dayReport.count({
      where: { therapistId: DOCTOR_ID, submittedAt: { gte: REPURPOSED_AT } },
    }),
    programSubmissions: await db.homeProgramApproval.count({
      where: { submittedById: DOCTOR_ID, submittedAt: { gte: REPURPOSED_AT } },
    }),
  };

  log(
    existingOccupantUser
      ? `occupant already has their own account (${existingOccupantUser.id}) — will reuse it`
      : `would create a new ${occupant.role} account for the occupant`,
  );
  log(
    `therapist-side rows to re-point (created after ${REPURPOSED_AT.toISOString()}): ${JSON.stringify(movable)}`,
  );
  log(
    `would restore ${DOCTOR_ID} → ${ORIGINAL.fullNameEn} <${ORIGINAL.email}> (DOCTOR), passwordHash cleared`,
  );

  if (!apply) {
    log('dry-run complete — re-run with --apply to execute');
    return;
  }

  await db.$transaction(async (tx) => {
    // 1. Preserve the occupant under their own account.
    let occupantId = existingOccupantUser?.id;
    if (!occupantId) {
      const created = await tx.user.create({
        data: {
          role: occupant.role,
          email: occupant.email,
          phone: occupant.phone,
          fullNameEn: occupant.fullNameEn,
          fullNameAr: occupant.fullNameAr,
          languagePref: occupant.languagePref,
          passwordHash: occupant.passwordHash,
          whatsappReachable: occupant.whatsappReachable,
          mustChangePassword: false,
        },
        select: { id: true },
      });
      occupantId = created.id;
      if (specialties.length > 0) {
        await tx.userSpecialty.createMany({
          data: specialties.map((s) => ({ userId: occupantId!, specialtyId: s.specialtyId })),
          skipDuplicates: true,
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          entityType: 'User',
          entityId: occupantId,
          action: 'CREATE',
          after: {
            role: occupant.role,
            email: occupant.email,
            phone: occupant.phone,
            fullNameEn: occupant.fullNameEn,
            fullNameAr: occupant.fullNameAr,
            reason:
              'occupant of repurposed doctor account split into own user (scripts/restore-doctor.ts)',
          },
        },
      });
    }

    // 2. Re-point therapist-side rows created after the repurpose moment.
    await tx.sessionNote.updateMany({
      where: { therapistId: DOCTOR_ID, createdAt: { gte: REPURPOSED_AT } },
      data: { therapistId: occupantId },
    });
    await tx.appointmentTherapist.updateMany({
      where: { therapistId: DOCTOR_ID, appointment: { createdAt: { gte: REPURPOSED_AT } } },
      data: { therapistId: occupantId },
    });
    await tx.careTeamMember.updateMany({
      where: { clinicianId: DOCTOR_ID, assignedAt: { gte: REPURPOSED_AT } },
      data: { clinicianId: occupantId },
    });
    await tx.dayReport.updateMany({
      where: { therapistId: DOCTOR_ID, submittedAt: { gte: REPURPOSED_AT } },
      data: { therapistId: occupantId },
    });
    await tx.homeProgramApproval.updateMany({
      where: { submittedById: DOCTOR_ID, submittedAt: { gte: REPURPOSED_AT } },
      data: { submittedById: occupantId },
    });

    // 3. Restore the doctor identity on the original id.
    await tx.user.update({
      where: { id: DOCTOR_ID },
      data: {
        ...ORIGINAL,
        passwordHash: null,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        entityType: 'User',
        entityId: DOCTOR_ID,
        action: 'UPDATE',
        before: {
          role: occupant.role,
          email: occupant.email,
          phone: occupant.phone,
          fullNameEn: occupant.fullNameEn,
          fullNameAr: occupant.fullNameAr,
        } as Prisma.InputJsonValue,
        after: { ...ORIGINAL, restoredBy: 'scripts/restore-doctor.ts' },
      },
    });
  });

  log(
    'APPLIED: occupant preserved, doctor identity restored. Now run scripts/reset-staff-passwords.ts --apply',
  );
}

main()
  .catch((err) => {
    console.error('[restore-doctor] failed', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
