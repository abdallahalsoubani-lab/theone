import 'server-only';

import { AuditAction, IntakeStatus, IntakeType } from '@prisma/client';

import { db } from '@/lib/db';
import { buildAnswerRows } from '@/lib/intake/services';
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
          primaryComplaint: a.primaryComplaint,
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
  return { ok: true };
}
