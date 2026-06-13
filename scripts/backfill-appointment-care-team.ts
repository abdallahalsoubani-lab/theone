/**
 * One-off backfill (pre-Prompt 16) — every existing appointment's therapist
 * becomes a member of that patient's care team.
 *
 * Background: until now, booking an appointment did NOT add the therapist to
 * the patient's care team, so a therapist with appointments could still have
 * "My patients" = 0 (e.g. layan). Going forward the appointment-create /
 * reschedule / change-therapist flows back-fill this automatically; this
 * script recovers the appointments already in the database.
 *
 *   pnpm tsx scripts/backfill-appointment-care-team.ts            # dry-run (default)
 *   pnpm tsx scripts/backfill-appointment-care-team.ts --dry-run  # explicit dry-run
 *   pnpm tsx scripts/backfill-appointment-care-team.ts --apply    # write changes
 *
 * Safety:
 *   - Default is a DRY RUN; nothing is written without --apply.
 *   - Add-never-replace: only inserts (patient, clinician) rows that don't
 *     already exist. Existing memberships and other care-team members are
 *     untouched.
 *   - Idempotent: a second run reports 0 changes.
 *   - `assignedBy` = first ADMIN (the system actor for historical data), or the
 *     clinician themself if no admin exists.
 *   - Considers appointments of ANY status (a cancelled appointment still means
 *     the therapist was responsible for that patient at some point).
 */

import { CareTeamRole, PrismaClient, UserRole } from '@prisma/client';

const db = new PrismaClient();

interface PlannedAdd {
  patientId: string;
  patientName: string;
  clinicianId: string;
  clinicianName: string;
  role: CareTeamRole;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) {
    console.error('Pass either --apply or --dry-run, not both.');
    process.exit(1);
  }
  const dryRun = !apply;

  console.log(
    `\n[backfill-appointment-care-team] mode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY (writing changes)'}\n`,
  );

  // System actor for historical rows.
  const admin = await db.user.findFirst({
    where: { role: UserRole.ADMIN, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  // Distinct (patient, therapist) pairs across every appointment. Therapists
  // are a many-to-many join now (Prompt 20), so dedupe over the join table.
  const pairRows = await db.appointmentTherapist.findMany({
    select: { therapistId: true, appointment: { select: { patientId: true } } },
  });
  const pairMap = new Map<string, { patientId: string; therapistId: string }>();
  for (const r of pairRows) {
    const patientId = r.appointment.patientId;
    pairMap.set(`${patientId}:${r.therapistId}`, { patientId, therapistId: r.therapistId });
  }
  const pairs = [...pairMap.values()];

  // Existing memberships → skip set ("patientId:clinicianId").
  const existing = await db.careTeamMember.findMany({
    select: { patientId: true, clinicianId: true },
  });
  const have = new Set(existing.map((m) => `${m.patientId}:${m.clinicianId}`));

  // Resolve clinician roles once (a therapistId is usually a THERAPIST but the
  // resource column also allows DOCTOR; the care-team role must match).
  const clinicianIds = [...new Set(pairs.map((p) => p.therapistId))];
  const clinicians = await db.user.findMany({
    where: { id: { in: clinicianIds }, deletedAt: null },
    select: { id: true, role: true, fullNameEn: true },
  });
  const clinicianById = new Map(clinicians.map((c) => [c.id, c]));

  const patientIds = [...new Set(pairs.map((p) => p.patientId))];
  const patients = await db.user.findMany({
    where: { id: { in: patientIds } },
    select: { id: true, fullNameEn: true },
  });
  const patientById = new Map(patients.map((p) => [p.id, p]));

  const planned: PlannedAdd[] = [];
  let skippedExisting = 0;
  let skippedNonClinician = 0;

  for (const pair of pairs) {
    if (have.has(`${pair.patientId}:${pair.therapistId}`)) {
      skippedExisting += 1;
      continue;
    }
    const clinician = clinicianById.get(pair.therapistId);
    const role =
      clinician?.role === UserRole.THERAPIST
        ? CareTeamRole.THERAPIST
        : clinician?.role === UserRole.DOCTOR
          ? CareTeamRole.DOCTOR
          : null;
    if (!role) {
      skippedNonClinician += 1;
      continue;
    }
    planned.push({
      patientId: pair.patientId,
      patientName: patientById.get(pair.patientId)?.fullNameEn ?? pair.patientId,
      clinicianId: pair.therapistId,
      clinicianName: clinician!.fullNameEn,
      role,
    });
  }

  console.log(`Distinct appointment (patient, therapist) pairs: ${pairs.length}`);
  console.log(`Already on care team (skipped):                 ${skippedExisting}`);
  console.log(`Therapist no longer a valid clinician (skipped):${skippedNonClinician}`);
  console.log(`To add:                                         ${planned.length}\n`);

  for (const p of planned) {
    console.log(`  + ${p.patientName} ← ${p.clinicianName} (${p.role})`);
  }
  console.log('');

  if (planned.length === 0) {
    console.log('Nothing to backfill.\n');
    await db.$disconnect();
    return;
  }

  if (dryRun) {
    console.log('Dry run — no changes written. Re-run with --apply to commit.\n');
    await db.$disconnect();
    return;
  }

  let added = 0;
  for (const p of planned) {
    await db.careTeamMember.upsert({
      where: { patientId_clinicianId: { patientId: p.patientId, clinicianId: p.clinicianId } },
      update: {},
      create: {
        patientId: p.patientId,
        clinicianId: p.clinicianId,
        role: p.role,
        assignedBy: admin?.id ?? p.clinicianId,
      },
    });
    added += 1;
  }
  console.log(`Applied: ${added} care-team member(s) added.\n`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error('[backfill-appointment-care-team] failed:', err);
  await db.$disconnect();
  process.exit(1);
});
