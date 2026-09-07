'use server';

import { z } from 'zod';

import { fail, ok, type Result } from '@/lib/auth/result';
import { toLocalizedError, type LocalizedError } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { CUSTOM_TEXT_MAX } from './customText';
import {
  ManualSendError,
  getManualMessageOptions,
  lastSentOfType,
  sendManualAppointmentMessage,
  type ManualSendErrorCode,
} from './service';
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

export interface ManualMessageOptionDto {
  type: ManualMessageType;
  preview: string | null;
  lastSentAt: string | null;
}

export interface ManualMessageOptionsDto {
  hasPatient: boolean;
  hasPhone: boolean;
  language: 'AR' | 'EN';
  patientFirstName: string;
  customFrame: string | null;
  customApproved: boolean;
  options: ManualMessageOptionDto[];
}

export async function getManualMessageOptionsAction(
  appointmentId: string,
): Promise<Result<ManualMessageOptionsDto>> {
  await requirePermission('whatsapp_manual.send');
  try {
    const o = await getManualMessageOptions(appointmentId);
    return ok({
      hasPatient: o.hasPatient,
      hasPhone: o.hasPhone,
      language: o.language,
      patientFirstName: o.patientFirstName,
      customFrame: o.customFrame,
      customApproved: o.customApproved,
      options: o.options.map((x) => ({
        type: x.type,
        preview: x.preview,
        lastSentAt: x.lastSentAt ? x.lastSentAt.toISOString() : null,
      })),
    });
  } catch (err) {
    return fail(toLocalizedError(err));
  }
}

export type ManualSendActionResult =
  | { needsConfirmation: true; lastSentAt: string }
  | {
      needsConfirmation: false;
      jobId: string | null;
      templateName: string;
      language: 'AR' | 'EN';
      sentAt: string;
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
  const { appointmentId, type, customText, confirmResend } = parsed.data;
  try {
    // Decision 7 — duplicate guard: warn with the time, never silently block.
    const last = await lastSentOfType(appointmentId, type);
    if (last && !confirmResend) {
      return ok({ needsConfirmation: true, lastSentAt: last.toISOString() });
    }
    const r = await sendManualAppointmentMessage({
      appointmentId,
      type,
      customText,
      resend: Boolean(last),
      actorId: user.id,
    });
    return ok({
      needsConfirmation: false,
      jobId: r.jobId,
      templateName: r.templateName,
      language: r.language,
      sentAt: r.sentAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof ManualSendError) return fail(ERRORS[err.code]);
    return fail(toLocalizedError(err));
  }
}
