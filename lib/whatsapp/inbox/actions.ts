'use server';

import { AuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { fail, ok, type Result } from '@/lib/auth/result';
import { withAudit } from '@/lib/audit/withAudit';
import { db, type LocalizedError } from '@/lib/db';
import { getEffectiveSession } from '@/lib/impersonation/session';
import { updatePatient } from '@/lib/patients/services';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { canAccessInbox, canSendFreeText } from './queries';

/**
 * WhatsApp Inbox mutations (Prompt 49). RBAC is enforced HERE at the data
 * layer — SECRETARY + ADMIN only (owner decision §1.1) — so no route can
 * leak conversations to therapists/doctors.
 */

const FORBIDDEN: LocalizedError = {
  code: 'FORBIDDEN',
  message_en: 'You do not have permission for this action.',
  message_ar: 'ليست لديك صلاحية لهذا الإجراء.',
};

const WINDOW_CLOSED: LocalizedError = {
  code: 'WA_WINDOW_CLOSED',
  message_en: 'The free-reply window has closed — the patient must message us first.',
  message_ar: 'انتهت نافذة الرد الحر — يجب أن يراسلنا المريض أولاً.',
};

async function requireInboxUser(): Promise<{ id: string; role: string } | null> {
  const session = await getEffectiveSession();
  if (!session?.user || !canAccessInbox(session.user.role)) return null;
  return session.user;
}

function revalidateInbox(): void {
  revalidatePath('/[locale]/(staff)/secretary/whatsapp', 'page');
}

// ─── Shared read state (§1.3) ─────────────────────────────────────────────

export async function markConversationReadAction(
  conversationId: string,
): Promise<Result<{ conversationId: string }>> {
  const user = await requireInboxUser();
  if (!user) return fail(FORBIDDEN);
  await db.whatsAppConversation.update({
    where: { id: conversationId },
    data: { lastReadAt: new Date() },
  });
  revalidateInbox();
  return ok({ conversationId });
}

// ─── Free-text reply (§3.3) ───────────────────────────────────────────────

const sendReplySchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

const sendReplyInner = withAudit<
  [{ conversationId: string; body: string; actorId: string }],
  { conversationId: string }
>(
  {
    entityType: 'WhatsAppConversation',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].conversationId,
    extractAfter: () => ({ event: 'INBOX_REPLY_SENT' }),
  },
  async function inner(input): Promise<{ conversationId: string }> {
    const c = await db.whatsAppConversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, phone: true, patientId: true, lastInboundAt: true },
    });
    if (!c) throw new Error('CONVERSATION_NOT_FOUND');
    // HARD server-side window check (Meta rule) — the UI disabling is not
    // the enforcement.
    if (!canSendFreeText(c.lastInboundAt)) throw new Error('WA_WINDOW_CLOSED');

    const patient = c.patientId
      ? await db.user.findUnique({
          where: { id: c.patientId },
          select: { languagePref: true },
        })
      : null;

    await enqueueWhatsappOutbound({
      kind: 'text',
      body: input.body,
      language: patient?.languagePref ?? 'AR',
      recipientPhone: c.phone,
      recipientUserId: c.patientId,
      source: 'inbox',
      sentById: input.actorId,
    });
    // A human owns the thread now: suppress intent acks for 1h (§1.2) and
    // count this as "read" for everyone.
    await db.whatsAppConversation.update({
      where: { id: c.id },
      data: { lastHumanReplyAt: new Date(), lastReadAt: new Date(), lastMessageAt: new Date() },
    });
    return { conversationId: c.id };
  },
);

export async function sendInboxReplyAction(
  input: unknown,
): Promise<Result<{ conversationId: string }>> {
  const user = await requireInboxUser();
  if (!user) return fail(FORBIDDEN);
  const parsed = sendReplySchema.safeParse(input);
  if (!parsed.success) {
    return fail({
      code: 'VALIDATION',
      message_en: 'Message text is required (max 2000 chars).',
      message_ar: 'نص الرسالة مطلوب (بحد أقصى 2000 حرف).',
    });
  }
  try {
    const data = await sendReplyInner({ ...parsed.data, actorId: user.id });
    revalidateInbox();
    return ok(data);
  } catch (err) {
    if (err instanceof Error && err.message === 'WA_WINDOW_CLOSED') return fail(WINDOW_CLOSED);
    return fail({
      code: 'SEND_FAILED',
      message_en: 'Could not send the message.',
      message_ar: 'تعذر إرسال الرسالة.',
    });
  }
}

// ─── Link unknown number to a patient (§3.4) ──────────────────────────────

const linkSchema = z.object({
  conversationId: z.string().min(1),
  patientId: z.string().min(1),
});

export async function linkConversationToPatientAction(
  input: unknown,
): Promise<Result<{ conversationId: string }>> {
  const user = await requireInboxUser();
  if (!user) return fail(FORBIDDEN);
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) {
    return fail({ code: 'VALIDATION', message_en: 'Invalid input.', message_ar: 'مدخل غير صالح.' });
  }
  const c = await db.whatsAppConversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: { id: true, phone: true },
  });
  if (!c) {
    return fail({
      code: 'NOT_FOUND',
      message_en: 'Conversation not found.',
      message_ar: 'المحادثة غير موجودة.',
    });
  }

  // The phone update rides the EXISTING audited patient-update service —
  // normalization/uniqueness/audit live there, never a raw write (§1.4).
  const patient = await db.user.findFirst({
    where: { id: parsed.data.patientId, role: 'PATIENT', deletedAt: null },
    include: { patientProfile: true },
  });
  if (!patient?.patientProfile) {
    return fail({
      code: 'NOT_FOUND',
      message_en: 'Patient not found.',
      message_ar: 'المريض غير موجود.',
    });
  }
  try {
    await updatePatient({
      id: patient.id,
      fullNameEn: patient.fullNameEn,
      fullNameAr: patient.fullNameAr,
      email: patient.email,
      phone: c.phone, // ← the conversation's number becomes the patient's
      languagePref: patient.languagePref,
      dateOfBirth: patient.patientProfile.dateOfBirth,
      gender: patient.patientProfile.gender,
      nationalId: patient.patientProfile.nationalId ?? '',
      address: patient.patientProfile.address ?? '',
      occupation: patient.patientProfile.occupation ?? '',
      emergencyContactName: patient.patientProfile.emergencyContactName ?? '',
      emergencyContactPhone: patient.patientProfile.emergencyContactPhone ?? '',
      medicalHistorySummary: patient.patientProfile.medicalHistorySummary ?? '',
      allergies: patient.patientProfile.allergies ?? '',
      currentMedications: patient.patientProfile.currentMedications ?? '',
      hijriCalendarPref: patient.patientProfile.hijriCalendarPref,
    } as Parameters<typeof updatePatient>[0]);
  } catch (err) {
    // Surface the existing uniqueness error verbatim (e.g. duplicate phone —
    // never a silent override).
    const localized = (err as { error?: LocalizedError })?.error;
    return fail(
      localized ?? {
        code: 'UPDATE_FAILED',
        message_en: 'Could not update the patient phone.',
        message_ar: 'تعذر تحديث رقم المريض.',
      },
    );
  }

  await db.whatsAppConversation.update({
    where: { id: c.id },
    data: { patientId: patient.id },
  });
  revalidateInbox();
  return ok({ conversationId: c.id });
}
