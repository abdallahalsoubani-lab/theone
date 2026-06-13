import { AppointmentStatus, AuditAction, UserRole } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import type {
  SessionNoteAddendumInput,
  SessionNoteCreateInput,
  SessionNoteUpdateInput,
} from './schemas';

/**
 * Session note services (Prompt 9 §4.7).
 *
 * Three mutations:
 *   - createSessionNote: writes a primary note + transitions the
 *     appointment to COMPLETED in one transaction. The partial unique
 *     index on (appointmentId WHERE parentNoteId IS NULL) blocks
 *     duplicates; we surface the error friendly before hitting it.
 *   - updateSessionNote: only the note author can edit, and only
 *     within 24 hours of creation. After 24h the action rejects with
 *     SESSION_NOTE_IMMUTABLE — the addendum mechanism takes over.
 *   - addAddendum: creates a child note pointing at its parent. Any
 *     therapist or doctor can write an addendum; the partial unique
 *     index has no clause on parentNoteId, so multiple addenda are
 *     allowed per appointment.
 */

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export class SessionNoteError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'SessionNoteError';
  }
}

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};
const notFound: LocalizedError = {
  code: 'SESSION_NOTE_NOT_FOUND',
  message_en: 'Session note not found.',
  message_ar: 'لم يتم العثور على ملاحظة الجلسة.',
};
const apptNotFound: LocalizedError = {
  code: 'APPOINTMENT_NOT_FOUND',
  message_en: 'Appointment not found.',
  message_ar: 'لم يتم العثور على الموعد.',
};
const forbidden: LocalizedError = {
  code: 'SESSION_NOTE_FORBIDDEN',
  message_en: 'You are not authorized to write this session note.',
  message_ar: 'غير مصرح لك بكتابة ملاحظة هذه الجلسة.',
};
const alreadyExists: LocalizedError = {
  code: 'SESSION_NOTE_EXISTS',
  message_en: 'A primary note already exists for this appointment. Add an addendum instead.',
  message_ar: 'توجد بالفعل ملاحظة أساسية لهذا الموعد. يرجى إضافة ملاحظة تكميلية بدلاً من ذلك.',
};
const immutable: LocalizedError = {
  code: 'SESSION_NOTE_IMMUTABLE',
  message_en:
    'Session notes are immutable after 24 hours. Add an addendum to record the correction.',
  message_ar: 'لا يمكن تعديل ملاحظات الجلسة بعد 24 ساعة. يرجى إضافة ملاحظة تكميلية لتسجيل التصحيح.',
};

function measurementsJson(value: string | null | undefined): Prisma.InputJsonValue {
  // Free-form text is stored under a 'text' key so the JSONB column has
  // a stable shape. Future structured fields can sit alongside without
  // a migration.
  return { text: value ?? '' } as Prisma.InputJsonValue;
}

// ─── Create primary session note ────────────────────────────────────────────
export const createSessionNote = withAudit<
  [SessionNoteCreateInput, { therapistId: string }],
  { noteId: string }
>(
  {
    entityType: 'SessionNote',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.noteId,
    extractAfter: () => ({ event: 'CREATED' }) as Prisma.InputJsonValue,
  },
  async function createInner(input, ctx): Promise<{ noteId: string }> {
    const appt = await db.appointment.findUnique({
      where: { id: input.appointmentId },
      select: {
        id: true,
        patientId: true,
        therapists: { select: { therapistId: true } },
        status: true,
      },
    });
    if (!appt) throw new SessionNoteError(apptNotFound);
    // Any therapist assigned to the session may write its one shared note
    // (Prompt 20). The note's author is recorded separately as ctx.therapistId.
    const assignedTherapistIds = appt.therapists.map((t) => t.therapistId);
    if (!assignedTherapistIds.includes(ctx.therapistId)) {
      // Admin override path still uses session.user.role check at the
      // facade; the service-level binding stays narrow.
      const session = await auth();
      if (session?.user?.role !== UserRole.ADMIN) throw new SessionNoteError(forbidden);
    }

    // Surface the duplicate-primary case as a localized error before
    // the partial unique index throws P2002.
    const existing = await db.sessionNote.findFirst({
      where: { appointmentId: appt.id, parentNoteId: null },
      select: { id: true },
    });
    if (existing) throw new SessionNoteError(alreadyExists);

    const note = await db.$transaction(async (tx) => {
      const created = await tx.sessionNote.create({
        data: {
          appointmentId: appt.id,
          patientId: appt.patientId,
          therapistId: ctx.therapistId,
          subjective: input.subjective ?? '',
          objective: input.objective ?? '',
          assessment: input.assessment ?? '',
          plan: input.plan ?? '',
          painScore: input.painScore,
          measurements: measurementsJson(input.measurements),
        },
        select: { id: true },
      });
      // Mark the appointment COMPLETED. The status state machine in
      // Prompt 7 allows IN_PROGRESS → COMPLETED; from SCHEDULED /
      // CONFIRMED we still allow the direct move (saving a note from
      // the side panel is the canonical path; see commit 7's wire-up).
      if (appt.status !== AppointmentStatus.COMPLETED) {
        await tx.appointment.update({
          where: { id: appt.id },
          data: { status: AppointmentStatus.COMPLETED },
        });
      }
      return created;
    });
    return { noteId: note.id };
  },
);

// ─── Update within 24h window ──────────────────────────────────────────────
export const updateSessionNote = withAudit<
  [SessionNoteUpdateInput, { therapistId: string }],
  { noteId: string }
>(
  {
    entityType: 'SessionNote',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].noteId,
    extractAfter: () => ({ event: 'UPDATED' }) as Prisma.InputJsonValue,
  },
  async function updateInner(input, ctx): Promise<{ noteId: string }> {
    const note = await db.sessionNote.findUnique({
      where: { id: input.noteId },
      select: { id: true, therapistId: true, createdAt: true },
    });
    if (!note) throw new SessionNoteError(notFound);
    if (note.therapistId !== ctx.therapistId) {
      const session = await auth();
      if (session?.user?.role !== UserRole.ADMIN) throw new SessionNoteError(forbidden);
    }
    if (Date.now() - note.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new SessionNoteError(immutable);
    }
    await db.sessionNote.update({
      where: { id: note.id },
      data: {
        subjective: input.subjective ?? '',
        objective: input.objective ?? '',
        assessment: input.assessment ?? '',
        plan: input.plan ?? '',
        painScore: input.painScore,
        measurements: measurementsJson(input.measurements),
      },
    });
    return { noteId: note.id };
  },
);

// ─── Addendum ──────────────────────────────────────────────────────────────
export const addSessionNoteAddendum = withAudit<
  [SessionNoteAddendumInput, { actorId: string }],
  { noteId: string }
>(
  {
    entityType: 'SessionNote',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.noteId,
    extractAfter: () => ({ event: 'ADDENDUM' }) as Prisma.InputJsonValue,
  },
  async function addendumInner(input, ctx): Promise<{ noteId: string }> {
    const parent = await db.sessionNote.findUnique({
      where: { id: input.parentNoteId },
      select: { id: true, appointmentId: true, patientId: true, parentNoteId: true },
    });
    if (!parent) throw new SessionNoteError(notFound);
    if (parent.parentNoteId) {
      // Addenda chain off the *primary* note. Chains of chains would
      // confuse the timeline; if a Doctor wants to amend an addendum,
      // they amend the primary.
      throw new SessionNoteError({
        code: 'SESSION_NOTE_ADDENDUM_CHAIN',
        message_en: 'Addenda must reference the primary note, not another addendum.',
        message_ar:
          'يجب أن تشير الملاحظات التكميلية إلى الملاحظة الأساسية وليس إلى ملاحظة تكميلية أخرى.',
      });
    }
    const created = await db.sessionNote.create({
      data: {
        appointmentId: parent.appointmentId,
        patientId: parent.patientId,
        therapistId: ctx.actorId,
        parentNoteId: parent.id,
        subjective: input.subjective ?? '',
        objective: input.objective ?? '',
        assessment: input.assessment ?? '',
        plan: input.plan ?? '',
        painScore: input.painScore,
        measurements: measurementsJson(input.measurements),
      },
      select: { id: true },
    });
    return { noteId: created.id };
  },
);

export function sessionNoteToLocalized(err: unknown): LocalizedError {
  if (err instanceof SessionNoteError) return err.error;
  return toLocalizedError(err);
}

export async function currentTherapistOrAdminId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new SessionNoteError(unauthenticated);
  if (session.user.role !== UserRole.THERAPIST && session.user.role !== UserRole.ADMIN) {
    throw new SessionNoteError(forbidden);
  }
  return session.user.id;
}

export async function currentClinicianId(): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new SessionNoteError(unauthenticated);
  // THERAPIST + DOCTOR + ADMIN can add addenda.
  if (
    session.user.role !== UserRole.THERAPIST &&
    session.user.role !== UserRole.DOCTOR &&
    session.user.role !== UserRole.ADMIN
  ) {
    throw new SessionNoteError(forbidden);
  }
  return session.user.id;
}
