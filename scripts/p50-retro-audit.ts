/**
 * P50 (revised) — owner decision #7: retrospective audit entry for the
 * 19 Aug 2026 production patient purge.
 *
 * The purge itself was executed with raw SQL outside the `withAudit` layer,
 * so the append-only audit log has no record of it. This script writes ONE
 * clearly-labelled RETROSPECTIVE row after the fact. It is explicitly marked
 * as written after the event — it does not pretend to be a contemporaneous
 * record (`retrospective: true`, `recordedAt` = run time, `occurredAt` = the
 * purge timestamp).
 *
 * Idempotent: a second run finds the existing row and exits without writing.
 *
 * Run on the VM:  dotenv -e .env.local -- tsx scripts/p50-retro-audit.ts
 */

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

const EVENT = 'P50_PATIENT_PURGE_RETROSPECTIVE';

async function main(): Promise<void> {
  const existing = await db.auditLog.findFirst({
    where: {
      entityType: 'System',
      after: { path: ['event'], equals: EVENT },
    },
    select: { id: true, createdAt: true },
  });
  if (existing) {
    console.log(`[p50-retro-audit] row already present (id=${existing.id}) — nothing to do`);
    return;
  }

  const row = await db.auditLog.create({
    data: {
      actorId: SYSTEM_USER_ID,
      entityType: 'System',
      entityId: 'patient-purge-2026-08-19',
      action: 'DELETE',
      after: {
        event: EVENT,
        retrospective: true,
        occurredAt: '2026-08-19T01:18:00+03:00',
        note: 'All patient data deleted from production on the owner’s explicit instruction, executed as raw SQL outside withAudit — this row was written after the fact (P50 revised, decision #7) and is NOT a contemporaneous record.',
        deleted: {
          patients: 265,
          appointments: 54,
          intakeAssessments: 262,
          intakeCustomAnswers: 2816,
          adultIntakeData: 115,
          pediatricIntakeData: 147,
          whatsappMessages: 156,
          whatsappConversations: 9,
          whatsappDispatches: 2,
          inboxItems: 5,
          treatmentPlans: 1,
          planExercises: 1,
          homeProgramItems: 2,
          homeProgramApprovals: 2,
          intakeSubmissions: 4,
          pediatricAssessments: 2,
          patientDocuments: 2,
          waitlistEntries: 1,
          notifications: 6,
          careTeamMembers: 38,
          appointmentTherapists: 68,
          dayReports: 0,
          sessionNotes: 0,
          auditRowsWithPatientActor: 16,
        },
        auditLogBeforeAfter: { before: 729, after: 713 },
      },
    },
    select: { id: true },
  });
  console.log(`[p50-retro-audit] retrospective purge record written (id=${row.id})`);
}

main()
  .catch((err) => {
    console.error('[p50-retro-audit] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
