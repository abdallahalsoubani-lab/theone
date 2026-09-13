'use server';

import { z } from 'zod';

import { fail, ok, type Result } from '@/lib/auth/result';
import { toLocalizedError, type LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { CUSTOM_TEXT_MAX } from './customText';
import {
  ManualSendError,
  getManualMessageOptions,
  lastSentByRecipient,
  sendManualAppointmentMessage,
  type ManualSendErrorCode,
} from './service';
import { loadMessageRecipients } from './recipients';
import { MANUAL_MESSAGE_TYPES, type ManualMessageType } from './types';

/**
 * P60 — server actions behind the appointment panel's "Send a message"
 * section. RBAC: `whatsapp_manual.send` (SECRETARY + ADMIN; Act-As
 * resolves to the effective user via requirePermission). Never trusts the
 * UI: the service re-validates applicability + text on every send.
 */

const sendSchema = z.object({
  appointmentId: z.string().min(1),
  type: z.enum(MANUAL_MESSAGE_TYPES),
  // Raw text; the service normalizes (newlines/tabs → spaces, 4+ spaces
  // collapsed) and enforces 1–CUSTOM_TEXT_MAX after normalization. The
  // generous raw cap only stops absurd payloads.
  customText: z
    .string()
    .max(CUSTOM_TEXT_MAX * 4)
    .optional(),
  /** P61 — which patients of the appointment to message. Omitted/empty =
   *  every recipient. The service re-derives the valid set and rejects any
   *  id that is not on the appointment. */
  recipientIds: z.array(z.string().min(1)).max(200).optional(),
  confirmResend: z.boolean().optional().default(false),
});

const ERRORS: Record<ManualSendErrorCode, LocalizedError> = {
  APPOINTMENT_NOT_FOUND: {
    code: 'APPOINTMENT_NOT_FOUND',
    message_en: 'Appointment not found.',
    message_ar: 'الموعد غير موجود.',
  },
  NO_PATIENT: {
    code: 'NO_PATIENT',
    message_en: 'This appointment has no patient to message.',
    message_ar: 'لا يوجد مريض لهذا الموعد لمراسلته.',
  },
  RECIPIENT_NOT_ON_APPOINTMENT: {
    code: 'RECIPIENT_NOT_ON_APPOINTMENT',
    message_en: 'One of the selected patients is not on this appointment.',
    message_ar: 'أحد المرضى المحددين ليس ضمن هذا الموعد.',
  },
  NO_PHONE: {
    code: 'NO_PHONE',
    message_en: 'The patient has no phone number.',
    message_ar: 'لا يوجد رقم هاتف للمريض.',
  },
  TYPE_NOT_APPLICABLE: {
    code: 'TYPE_NOT_APPLICABLE',
    message_en: 'This message type does not apply to the appointment in its current state.',
    message_ar: 'هذا النوع من الرسائل لا ينطبق على الموعد في حالته الحالية.',
  },
  CUSTOM_TEMPLATE_PENDING: {
    code: 'CUSTOM_TEMPLATE_PENDING',
    message_en: 'The custom-message template is still pending WhatsApp approval.',
    message_ar: 'قالب الرسالة المخصصة ما زال قيد الاعتماد لدى واتساب.',
  },
  CUSTOM_TEXT_EMPTY: {
    code: 'CUSTOM_TEXT_EMPTY',
    message_en: 'Write the message text first.',
    message_ar: 'اكتب نص الرسالة أولاً.',
  },
  CUSTOM_TEXT_TOO_LONG: {
    code: 'CUSTOM_TEXT_TOO_LONG',
    message_en: `The message is too long (max ${CUSTOM_TEXT_MAX} characters).`,
    message_ar: `الرسالة طويلة جداً (الحد الأقصى ${CUSTOM_TEXT_MAX} حرفاً).`,
  },
  NOTHING_TO_SEND: {
    code: 'NOTHING_TO_SEND',
    message_en: 'Nothing could be sent — the appointment or template changed. Reload and retry.',
    message_ar: 'تعذّر الإرسال — تغيّر الموعد أو القالب. أعد التحميل وحاول مجدداً.',
  },
};

export interface ManualRecipientDto {
  patientId: string;
  fullNameEn: string;
  fullNameAr: string;
  language: 'AR' | 'EN';
  firstName: string;
  hasPhone: boolean;
}

export interface ManualMessageOptionDto {
  type: ManualMessageType;
  applicableRecipientIds: string[];
  /** One preview per distinct language among the applicable recipients. */
  previewByLanguage: Partial<Record<'AR' | 'EN', string | null>>;
  /** patientId → ISO timestamp of the last non-failed send of this type. */
  lastSentByRecipient: Record<string, string>;
}

export interface ManualMessageOptionsDto {
  recipients: ManualRecipientDto[];
  customFrameByLanguage: Partial<Record<'AR' | 'EN', string | null>>;
  customApprovedByLanguage: Record<'AR' | 'EN', boolean>;
  options: ManualMessageOptionDto[];
}

export async function getManualMessageOptionsAction(
  appointmentId: string,
): Promise<Result<ManualMessageOptionsDto>> {
  await requirePermission('whatsapp_manual.send');
  try {
    const o = await getManualMessageOptions(appointmentId);
    return ok({
      recipients: o.recipients,
      customFrameByLanguage: o.customFrameByLanguage,
      customApprovedByLanguage: o.customApprovedByLanguage,
      options: o.options.map((x) => ({
        type: x.type,
        applicableRecipientIds: x.applicableRecipientIds,
        previewByLanguage: x.previewByLanguage,
        lastSentByRecipient: Object.fromEntries(
          Object.entries(x.lastSentByRecipient).map(([id, d]) => [id, d.toISOString()]),
        ),
      })),
    });
  } catch (err) {
    return fail(toLocalizedError(err));
  }
}

export interface ManualSendRecipientResultDto {
  patientId: string;
  ok: boolean;
  /** Localized failure reason — only set when ok is false. */
  error: LocalizedError | null;
}

export type ManualSendActionResult =
  | {
      /** P61 — the duplicate guard is PER PATIENT: these already received
       *  this type. Re-submitting with confirmResend sends to whoever is
       *  still selected. */
      needsConfirmation: true;
      alreadySent: { patientId: string; lastSentAt: string }[];
    }
  | {
      needsConfirmation: false;
      batchId: string;
      sentAt: string;
      sentCount: number;
      totalCount: number;
      results: ManualSendRecipientResultDto[];
    };

export async function sendManualAppointmentMessageAction(
  input: unknown,
): Promise<Result<ManualSendActionResult>> {
  const user = await requirePermission('whatsapp_manual.send');
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) {
    return fail({
      code: 'VALIDATION',
      message_en: 'Invalid input.',
      message_ar: 'مدخل غير صالح.',
    });
  }
  const { appointmentId, type, customText, recipientIds, confirmResend } = parsed.data;
  try {
    // Decision 7 (P61: per patient) — duplicate guard warns naming WHO
    // already received it, and never silently blocks.
    const recipients = await loadMessageRecipients(appointmentId);
    const targetIds =
      recipientIds && recipientIds.length > 0 ? recipientIds : recipients.map((r) => r.id);
    const last = await lastSentByRecipient(appointmentId, type, targetIds);
    if (last.size > 0 && !confirmResend) {
      return ok({
        needsConfirmation: true,
        alreadySent: [...last.entries()].map(([patientId, d]) => ({
          patientId,
          lastSentAt: d.toISOString(),
        })),
      });
    }
    const r = await sendManualAppointmentMessage({
      appointmentId,
      type,
      customText,
      recipientIds,
      resend: last.size > 0,
      actorId: user.id,
    });
    return ok({
      needsConfirmation: false,
      batchId: r.batchId,
      sentAt: r.sentAt.toISOString(),
      sentCount: r.results.filter((x) => x.ok).length,
      totalCount: r.results.length,
      results: r.results.map((x) => ({
        patientId: x.patientId,
        ok: x.ok,
        error: x.ok ? null : (ERRORS[x.code] ?? null),
      })),
    });
  } catch (err) {
    if (err instanceof ManualSendError) return fail(ERRORS[err.code]);
    return fail(toLocalizedError(err));
  }
}
