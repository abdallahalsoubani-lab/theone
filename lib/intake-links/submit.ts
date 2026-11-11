import 'server-only';

import { AuditAction, IntakeStatus, IntakeType, UserRole } from '@prisma/client';

import { db } from '@/lib/db';
import { patientDisplayName } from '@/lib/format/patientName';
import { assertRequiredCustomAnswers, buildAnswerRows } from '@/lib/intake/services';
import { createNotification } from '@/lib/notifications/actions';
import { getCareTeam } from '@/lib/patients/assignment';
import { patientProfileHref } from '@/lib/patients/links';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

import { linkSubmissionSchema, type LinkSubmissionInput } from './schemas';
import { redactToken } from './tokens';

export class IntakeLinkSubmitError extends Error {
  constructor(public readonly code: 'INVALID_LINK' | 'FORM_TYPE_MISMATCH' | 'VALIDATION') {
    super(code);
    this.name = 'IntakeLinkSubmitError';
  }
}

/**
 * P52 — submit a personal intake through its token. Saves DIRECTLY onto the
 * patient file (no secretary review — owner decision 3), sets the link's
 * usedAt (single-use — decision 4), and audits the submission with the
 * SYSTEM actor tagged "via intake link".
 *
 * Identity safety (decision: name/phone are locked): the service resolves
 * the patient id from the TOKEN and never reads `profile.fullNameEn` /
 * `profile.phone` from the payload — a tampered payload cannot change who
 * the intake belongs to or their contact fields. The other profile fields
 * (DOB, gender, language, address, email) are written.
 *
 * Single-use is race-safe: the link is claimed (`usedAt` set where still
 * null) inside the transaction, so a concurrent double-submit resolves to
 * exactly one winner; the loser gets INVALID_LINK.
 */
export async function submitIntakeViaLink(input: unknown): Promise<{ ok: true }> {
  const parsed = linkSubmissionSchema.safeParse(input);
  if (!parsed.success) throw new IntakeLinkSubmitError('VALIDATION');
  const data: LinkSubmissionInput = parsed.data;

  const link = await db.patientIntakeLink.findUnique({
    where: { token: data.token },
    select: { id: true, patientId: true, formType: true, usedAt: true },
  });
  // Unknown OR already-used → the same opaque failure (never reveal which).
  if (!link || link.usedAt) throw new IntakeLinkSubmitError('INVALID_LINK');

  const expectedType = data.type === 'ADULT' ? IntakeType.ADULT : IntakeType.PEDIATRIC;
  if (link.formType !== expectedType) throw new IntakeLinkSubmitError('FORM_TYPE_MISMATCH');

  const patientId = link.patientId;
  // P64 #8 — required admin questions (IntakeError with field details).
  await assertRequiredCustomAnswers(
    data.answers.customAnswers,
    data.type === 'ADULT' ? 'ADULT' : 'PEDIATRIC',
  );
  const answerRows = await buildAnswerRows(
    data.answers.customAnswers,
    data.type === 'ADULT' ? 'ADULT' : 'PEDIATRIC',
  );
  const profile = data.profile;

  await db.$transaction(async (tx) => {
    // Claim the link first — single-use, race-safe.
    const claimed = await tx.patientIntakeLink.updateMany({
      where: { id: link.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw new IntakeLinkSubmitError('INVALID_LINK');

    // Profile updates — DOB / gender / language / address / email. NEVER
    // name or phone (locked identity).
    await tx.user.update({
      where: { id: patientId },
      data: {
        languagePref: profile.languagePref ?? (data.locale === 'ar' ? 'AR' : 'EN'),
        email: profile.email ? profile.email : undefined,
      },
    });
    await tx.patientProfile.update({
      where: { userId: patientId },
      data: {
        dateOfBirth: new Date(`${profile.dateOfBirth}T00:00:00Z`),
        gender: profile.gender,
        address: profile.address || null,
      },
    });

    // The intake assessment itself (COMPLETED — straight to the file).
    const intake = await tx.intakeAssessment.create({
      data: {
        patientId,
        type: expectedType,
        assessedById: SYSTEM_USER_ID,
        status: IntakeStatus.COMPLETED,
      },
    });
    if (data.type === 'ADULT') {
      const a = data.answers;
      await tx.adultIntakeData.create({
        data: {
          intakeId: intake.id,
          physicalActivityLevel: a.physicalActivityLevel,
          medicalDiagnosis: a.medicalDiagnosis || null,
          primaryComplaint: a.primaryComplaint || null,
          painTiming: a.painTiming,
          symptomDuration: a.symptomDuration,
          painSeverity: a.painSeverity,
          painAggravatingFactors: a.painAggravatingFactors || null,
          painRelievingFactors: a.painRelievingFactors || null,
          painStability: a.painStability,
          currentMedicationsForProblem: a.currentMedicationsForProblem || null,
          otherMedications: a.otherMedications || null,
          conditions: a.conditions,
          otherConditions: a.otherConditions || null,
          previousFractures: a.previousFractures || null,
          previousSurgeries: a.previousSurgeries || null,
          previousPtExperience: a.previousPtExperience || null,
          referralSource: a.referralSource,
        },
      });
    } else {
      const a = data.answers;
      await tx.pediatricIntakeData.create({
        data: {
          intakeId: intake.id,
          numberOfSiblings: a.numberOfSiblings,
          birthOrder: a.birthOrder,
        },
      });
    }
    if (answerRows.length > 0) {
      await tx.intakeCustomAnswer.createMany({
        data: answerRows.map((r) => ({
          intakeId: intake.id,
          questionId: r.questionId,
          value: r.value,
          valueOptions: r.valueOptions === null ? undefined : (r.valueOptions as object),
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: SYSTEM_USER_ID,
        entityType: 'IntakeAssessment',
        entityId: intake.id,
        action: AuditAction.CREATE,
        after: {
          event: 'INTAKE_COMPLETED_VIA_LINK',
          patientId,
          type: data.type,
          linkId: link.id,
        },
      },
    });
  });

  console.warn(`[intake-link] submission stored via token=${redactToken(data.token)}`);
  await notifyIntakeLinkCompleted(patientId);
  return { ok: true };
}

/**
 * P64 #9 — «النموذج ما بيوصل»: a link submission saved straight to the file
 * in SILENCE (no review row, no notification), so the desk never knew it had
 * arrived. Now SECRETARY + ADMIN and the patient's care team each get one
 * notification. Best-effort: the intake is committed already; a notification
 * failure is logged (ids only) and never fails the patient's submit.
 */
async function notifyIntakeLinkCompleted(patientId: string): Promise<void> {
  try {
    const [patient, desk, team] = await Promise.all([
      db.user.findUnique({
        where: { id: patientId },
        select: { fullNameEn: true, fullNameAr: true },
      }),
      db.user.findMany({
        where: { role: { in: [UserRole.SECRETARY, UserRole.ADMIN] }, deletedAt: null },
        select: { id: true },
      }),
      getCareTeam(patientId),
    ]);
    const patientName = patientDisplayName(patient?.fullNameEn, patient?.fullNameAr);
    const recipients = new Map<string, string>();
    for (const u of desk) recipients.set(u.id, '/secretary/intake-submissions');
    for (const c of team.therapists) {
      if (!recipients.has(c.id)) recipients.set(c.id, patientProfileHref('THERAPIST', patientId));
    }
    for (const c of team.doctors) {
      if (!recipients.has(c.id)) recipients.set(c.id, patientProfileHref('DOCTOR', patientId));
    }
    await Promise.all(
      [...recipients].map(([recipientId, linkPath]) =>
        createNotification({
          recipientId,
          type: 'INTAKE_LINK_COMPLETED',
          params: { patientName },
          linkPath,
          relatedEntityType: 'User',
          relatedEntityId: patientId,
        }).catch((err: unknown) => {
          console.error('[intake-link] notification failed', err);
        }),
      ),
    );
  } catch (err) {
    console.error('[intake-link] notification fan-out failed', err);
  }
}
