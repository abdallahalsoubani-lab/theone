#!/usr/bin/env tsx
/**
 * Production reset (Prompt 50 §3.2) — wipes the trial-phase data so the
 * clinic enters real production clean. OWNER-APPROVED table list; the
 * classification is the signed-off report, not this file's opinion.
 *
 * SURVIVES: admin user(s) passed via --keep-admin, the reserved `system`
 * user (audit actor for workers — FK'd from AuditLog), ClinicSettings
 * (business hours, reminder settings, kiosk/display tokens), the
 * WhatsAppTemplate registry (live SIDs), the Exercise library, Specialty
 * reference rows, Rooms (replaced separately by seed-clinic-foundation),
 * IntakeCustomQuestion + PediatricCustomField (config — Prompt 51 aligns).
 *
 * WIPED: everything else — patients, staff, appointments, clinical data,
 * conversations + message log, notifications, waitlist, leave, audit log.
 *
 * Usage:
 *   pnpm tsx scripts/production-reset.ts --dry-run --keep-admin=a@b.c
 *   pnpm tsx scripts/production-reset.ts --apply --keep-admin=a@b.c \
 *     --backup-confirmed=/path/to/fresh-backup.sql
 *
 * --dry-run (default) prints per-table counts and touches NOTHING.
 * --apply refuses to run without --backup-confirmed pointing at an
 * existing non-empty file (mechanical seatbelt, not proof — take a real
 * backup first). Idempotent: a second --apply deletes zero rows.
 */

import { statSync } from 'node:fs';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

interface CliArgs {
  apply: boolean;
  keepAdminEmails: string[];
  backupPath: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run');
  if (apply && dryRun) {
    throw new Error('Pass either --dry-run or --apply, not both.');
  }
  const keepArg = argv.find((a) => a.startsWith('--keep-admin='));
  const backupArg = argv.find((a) => a.startsWith('--backup-confirmed='));
  return {
    apply,
    keepAdminEmails: (keepArg?.split('=')[1] ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    backupPath: backupArg?.split('=')[1] ?? null,
  };
}

/**
 * The wipe plan in FK-safe order (children before parents). Each entry is
 * a label + a delete executor + a counter. User comes last with the keep
 * filter applied.
 */
export async function runProductionReset(
  args: CliArgs,
  prisma: typeof db = db,
): Promise<{ deleted: Record<string, number>; keptUserIds: string[] }> {
  if (args.keepAdminEmails.length === 0) {
    throw new Error('--keep-admin=<email> is required (the owner account that survives).');
  }

  // Validate keep-admins exist and are ADMIN before touching anything.
  const keepAdmins = await prisma.user.findMany({
    where: { email: { in: args.keepAdminEmails }, deletedAt: null },
    select: { id: true, email: true, role: true },
  });
  const foundEmails = new Set(keepAdmins.map((u) => u.email?.toLowerCase()));
  for (const email of args.keepAdminEmails) {
    if (!foundEmails.has(email)) throw new Error(`--keep-admin user not found: ${email}`);
  }
  const nonAdmin = keepAdmins.find((u) => u.role !== 'ADMIN');
  if (nonAdmin) throw new Error(`--keep-admin user is not an ADMIN: ${nonAdmin.email}`);

  const keptUserIds = [...keepAdmins.map((u) => u.id), SYSTEM_USER_ID];

  if (args.apply) {
    if (!args.backupPath) {
      throw new Error('--apply requires --backup-confirmed=<path to a fresh backup>.');
    }
    let stat;
    try {
      stat = statSync(args.backupPath);
    } catch {
      throw new Error(`Backup file not found: ${args.backupPath}`);
    }
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Backup file is empty or not a file: ${args.backupPath}`);
    }
  }

  // FK-safe order: intake tree → clinical tree → scheduling → messaging →
  // misc → audit → users. Keep-list tables are simply absent.
  type Client = Parameters<Parameters<typeof db.$transaction>[0]>[0] | typeof db;
  const plan: Array<{
    table: string;
    count: () => Promise<number>;
    del: (c: Client) => Promise<number>;
  }> = [
    {
      table: 'IntakeCustomAnswer',
      count: () => prisma.intakeCustomAnswer.count(),
      del: (c) => c.intakeCustomAnswer.deleteMany().then((r) => r.count),
    },
    {
      table: 'AdultIntakeData',
      count: () => prisma.adultIntakeData.count(),
      del: (c) => c.adultIntakeData.deleteMany().then((r) => r.count),
    },
    {
      table: 'PediatricIntakeData',
      count: () => prisma.pediatricIntakeData.count(),
      del: (c) => c.pediatricIntakeData.deleteMany().then((r) => r.count),
    },
    {
      table: 'IntakeAssessment',
      count: () => prisma.intakeAssessment.count(),
      del: (c) => c.intakeAssessment.deleteMany().then((r) => r.count),
    },
    {
      table: 'IntakeSubmission',
      count: () => prisma.intakeSubmission.count(),
      del: (c) => c.intakeSubmission.deleteMany().then((r) => r.count),
    },
    {
      table: 'PediatricAssessment',
      count: () => prisma.pediatricAssessment.count(),
      del: (c) => c.pediatricAssessment.deleteMany().then((r) => r.count),
    },
    {
      table: 'PatientDocument',
      count: () => prisma.patientDocument.count(),
      del: (c) => c.patientDocument.deleteMany().then((r) => r.count),
    },
    {
      table: 'HomeProgramCompletion',
      count: () => prisma.homeProgramCompletion.count(),
      del: (c) => c.homeProgramCompletion.deleteMany().then((r) => r.count),
    },
    {
      table: 'HomeProgramApproval',
      count: () => prisma.homeProgramApproval.count(),
      del: (c) => c.homeProgramApproval.deleteMany().then((r) => r.count),
    },
    {
      table: 'HomeProgramItem',
      count: () => prisma.homeProgramItem.count(),
      del: (c) => c.homeProgramItem.deleteMany().then((r) => r.count),
    },
    {
      table: 'PlanExercise',
      count: () => prisma.planExercise.count(),
      del: (c) => c.planExercise.deleteMany().then((r) => r.count),
    },
    {
      table: 'SessionNote',
      count: () => prisma.sessionNote.count(),
      del: (c) => c.sessionNote.deleteMany().then((r) => r.count),
    },
    {
      table: 'TreatmentPlan',
      count: () => prisma.treatmentPlan.count(),
      del: (c) => c.treatmentPlan.deleteMany().then((r) => r.count),
    },
    {
      table: 'DayReport',
      count: () => prisma.dayReport.count(),
      del: (c) => c.dayReport.deleteMany().then((r) => r.count),
    },
    {
      table: 'DoctorReview',
      count: () => prisma.doctorReview.count(),
      del: (c) => c.doctorReview.deleteMany().then((r) => r.count),
    },
    {
      table: 'WaitlistEntry',
      count: () => prisma.waitlistEntry.count(),
      del: (c) => c.waitlistEntry.deleteMany().then((r) => r.count),
    },
    {
      table: 'AppointmentPatient',
      count: () => prisma.appointmentPatient.count(),
      del: (c) => c.appointmentPatient.deleteMany().then((r) => r.count),
    },
    {
      table: 'AppointmentTherapist',
      count: () => prisma.appointmentTherapist.count(),
      del: (c) => c.appointmentTherapist.deleteMany().then((r) => r.count),
    },
    {
      table: 'Appointment',
      count: () => prisma.appointment.count(),
      del: (c) => c.appointment.deleteMany().then((r) => r.count),
    },
    {
      table: 'WhatsAppMessage',
      count: () => prisma.whatsAppMessage.count(),
      del: (c) => c.whatsAppMessage.deleteMany().then((r) => r.count),
    },
    {
      table: 'WhatsAppConversation',
      count: () => prisma.whatsAppConversation.count(),
      del: (c) => c.whatsAppConversation.deleteMany().then((r) => r.count),
    },
    {
      table: 'InboxItem',
      count: () => prisma.inboxItem.count(),
      del: (c) => c.inboxItem.deleteMany().then((r) => r.count),
    },
    {
      table: 'Notification',
      count: () => prisma.notification.count(),
      del: (c) => c.notification.deleteMany().then((r) => r.count),
    },
    {
      table: 'Leave',
      count: () => prisma.leave.count(),
      del: (c) => c.leave.deleteMany().then((r) => r.count),
    },
    {
      table: 'CareTeamMember',
      count: () => prisma.careTeamMember.count(),
      del: (c) => c.careTeamMember.deleteMany().then((r) => r.count),
    },
    {
      table: 'PatientProfile',
      count: () => prisma.patientProfile.count(),
      del: (c) => c.patientProfile.deleteMany().then((r) => r.count),
    },
    {
      table: 'AuditLog',
      count: () => prisma.auditLog.count(),
      del: (c) => c.auditLog.deleteMany().then((r) => r.count),
    },
    {
      // Trial staff/patient UserSpecialty rows die with their users via
      // cascade, but delete explicitly so counts are visible.
      table: 'UserSpecialty',
      count: () => prisma.userSpecialty.count({ where: { userId: { notIn: keptUserIds } } }),
      del: (c) =>
        c.userSpecialty
          .deleteMany({ where: { userId: { notIn: keptUserIds } } })
          .then((r) => r.count),
    },
    {
      // Surviving CONTENT (exercise library, custom intake questions,
      // pediatric custom fields) keeps its rows while its trial-era
      // creators are wiped — authorship is re-pointed to the `system`
      // actor first, or the Restrict FKs would abort the whole wipe.
      table: 'creator re-point → system (kept content)',
      count: async () => {
        const w = { where: { createdById: { notIn: keptUserIds } } };
        return (
          (await prisma.exercise.count(w)) +
          (await prisma.intakeCustomQuestion.count(w)) +
          (await prisma.pediatricCustomField.count(w))
        );
      },
      del: async (c) => {
        const args = {
          where: { createdById: { notIn: keptUserIds } },
          data: { createdById: SYSTEM_USER_ID },
        };
        const a = await c.exercise.updateMany(args);
        const b = await c.intakeCustomQuestion.updateMany(args);
        const d = await c.pediatricCustomField.updateMany(args);
        return a.count + b.count + d.count;
      },
    },
    {
      table: 'User (except keep-admins + system)',
      count: () => prisma.user.count({ where: { id: { notIn: keptUserIds } } }),
      del: (c) => c.user.deleteMany({ where: { id: { notIn: keptUserIds } } }).then((r) => r.count),
    },
  ];

  const deleted: Record<string, number> = {};

  if (!args.apply) {
    console.log('── DRY RUN — nothing will be deleted ──');
    for (const step of plan) {
      deleted[step.table] = await step.count();
    }
  } else {
    console.log('── APPLYING RESET ──');
    // One transaction: either the whole wipe lands or none of it.
    await prisma.$transaction(
      async (tx) => {
        for (const step of plan) {
          deleted[step.table] = await step.del(tx);
        }
      },
      { timeout: 120_000 },
    );
  }

  const survivors = {
    keptUsers: keepAdmins.map((u) => u.email).concat('system@theone.internal (audit actor)'),
    clinicSettings: await prisma.clinicSettings.count(),
    whatsAppTemplates: await prisma.whatsAppTemplate.count(),
    exercises: await prisma.exercise.count(),
    specialties: await prisma.specialty.count(),
    rooms: await prisma.room.count(),
    intakeCustomQuestions: await prisma.intakeCustomQuestion.count(),
    pediatricCustomFields: await prisma.pediatricCustomField.count(),
  };

  console.log(`\n${args.apply ? 'Deleted' : 'Would delete'} per table:`);
  for (const [table, n] of Object.entries(deleted)) {
    console.log(`  ${table.padEnd(40)} ${n}`);
  }
  console.log('\nSurvives:');
  for (const [k, v] of Object.entries(survivors)) {
    console.log(`  ${k.padEnd(40)} ${Array.isArray(v) ? v.join(', ') : v}`);
  }

  return { deleted, keptUserIds };
}

// Entry point — only when executed directly (not imported by tests).
if (process.argv[1]?.endsWith('production-reset.ts')) {
  runProductionReset(parseArgs(process.argv.slice(2)))
    .then(() => {
      console.log('\nDone.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(
        `\n[production-reset] REFUSED/FAILED: ${err instanceof Error ? err.message : err}`,
      );
      process.exit(1);
    });
}

export { parseArgs };
