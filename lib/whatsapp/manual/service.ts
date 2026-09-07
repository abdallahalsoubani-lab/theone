import { AuditAction, type LanguagePref } from '@prisma/client';

import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { closeOpenDispatchForManualSend } from '@/lib/whatsapp/dispatch/service';
import { isTemplateApproved } from '@/lib/whatsapp/templates/approval';
import { patientFirstName } from '@/lib/whatsapp/templates/firstName';
import { renderTemplatePreview, templateFrame } from '@/lib/whatsapp/templates/preview';
import {
  buildAppointmentReminderMessages,
  loadReminderAppointment,
} from '@/lib/whatsapp/templates/reminderBuilder';
import {
  composeArrivalConfirmation,
  sendArrivalConfirmation,
} from '@/lib/whatsapp/templates/sendArrival';
import {
  composeAppointmentCancelled,
  sendAppointmentCancelled,
} from '@/lib/whatsapp/templates/sendCancelled';
import {
  composeAppointmentConfirmation,
  sendAppointmentConfirmation,
} from '@/lib/whatsapp/templates/sendConfirmation';
import {
  CUSTOM_MESSAGE_TEMPLATE,
  composeCustomMessage,
  sendCustomMessage,
} from '@/lib/whatsapp/templates/sendCustomMessage';
import {
  composeAppointmentRescheduled,
  sendAppointmentRescheduled,
} from '@/lib/whatsapp/templates/sendRescheduled';
import type { ComposedMessage, SendOutcome } from '@/lib/whatsapp/templates/types';

import { applicableManualTypes, isManualTypeApplicable } from './applicability';
import { validateCustomText } from './customText';
import {
  DISPATCH_TYPE_BY_MANUAL,
  TEMPLATE_FAMILY_BY_MANUAL,
  type ManualMessageType,
} from './types';

/**
 * P60 — manual "Send a message" from the appointment panel. db-only (no
 * Next request machinery) so the same code is testable without a session.
 *
 * Human-initiated by definition (owner decision 4): never consults the P48
 * mode or the P51 silent mode, always `force` past a stale
 * whatsappReachable flag. The outbound queue's rate limits still apply.
 */

export type ManualSendErrorCode =
  | 'APPOINTMENT_NOT_FOUND'
  | 'NO_PATIENT'
  | 'NO_PHONE'
  | 'TYPE_NOT_APPLICABLE'
  | 'CUSTOM_TEMPLATE_PENDING'
  | 'CUSTOM_TEXT_EMPTY'
  | 'CUSTOM_TEXT_TOO_LONG'
  | 'NOTHING_TO_SEND';

export class ManualSendError extends Error {
  constructor(public readonly code: ManualSendErrorCode) {
    super(code);
    this.name = 'ManualSendError';
  }
}

interface ManualContext {
  id: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  startsAt: Date;
  durationMinutes: number;
  checkedInAt: Date | null;
  patient: {
    id: string;
    phone: string | null;
    languagePref: LanguagePref;
    fullNameEn: string;
    fullNameAr: string;
  } | null;
}

async function loadManualContext(appointmentId: string): Promise<ManualContext | null> {
  return db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      durationMinutes: true,
      checkedInAt: true,
      patient: {
        select: { id: true, phone: true, languagePref: true, fullNameEn: true, fullNameAr: true },
      },
    },
  });
}

/** The most recent non-failed outbound of this type for the appointment —
 *  the duplicate guard's "already sent at" (decision 7). */
export async function lastSentOfType(
  appointmentId: string,
  type: ManualMessageType,
): Promise<Date | null> {
  const row = await db.whatsAppMessage.findFirst({
    where: {
      appointmentId,
      direction: 'OUTBOUND',
      status: { not: 'FAILED' },
      template: { name: { in: [...TEMPLATE_FAMILY_BY_MANUAL[type]] } },
    },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });
  return row?.sentAt ?? null;
}

/** Compose (never enqueue) the message the panel would send for one type. */
async function composeForType(
  type: ManualMessageType,
  ctx: ManualContext & { patient: NonNullable<ManualContext['patient']> },
  customText?: string,
): Promise<ComposedMessage | null> {
  const forPatient = (list: ComposedMessage[]) =>
    list.find((m) => m.recipientUserId === ctx.patient.id) ?? null;
  switch (type) {
    case 'CONFIRMATION':
      return composeAppointmentConfirmation({ appointmentId: ctx.id, force: true });
    case 'REMINDER': {
      const appt = await loadReminderAppointment(ctx.id);
      return appt ? forPatient(await buildAppointmentReminderMessages(appt)) : null;
    }
    case 'RESCHEDULE':
      return forPatient(
        await composeAppointmentRescheduled({ appointmentId: ctx.id, force: true }),
      );
    case 'CANCELLATION':
      return composeAppointmentCancelled({ appointmentId: ctx.id, force: true });
    case 'ARRIVAL':
      return composeArrivalConfirmation({
        patientId: ctx.patient.id,
        appointmentIds: [ctx.id],
        force: true,
      });
    case 'CUSTOM':
      return composeCustomMessage({
        patientId: ctx.patient.id,
        appointmentId: ctx.id,
        text: customText ?? '',
        force: true,
      });
  }
}

/** Send through the SHARED sender of the type (decision: no duplicated
 *  template logic) with the manual-panel markers. */
async function sendForType(
  type: ManualMessageType,
  ctx: ManualContext & { patient: NonNullable<ManualContext['patient']> },
  actorId: string,
  customText?: string,
): Promise<SendOutcome | null> {
  const opts = { force: true, source: 'manual_panel' as const, sentById: actorId };
  switch (type) {
    case 'CONFIRMATION':
      return sendAppointmentConfirmation({ appointmentId: ctx.id, ...opts });
    case 'REMINDER': {
      // The reminder has no standalone sender: the worker and this path
      // share the ONE builder and each enqueue what it returns.
      const appt = await loadReminderAppointment(ctx.id);
      if (!appt) return null;
      const m = (await buildAppointmentReminderMessages(appt)).find(
        (x) => x.recipientUserId === ctx.patient.id,
      );
      if (!m) return null;
      const jobId = await enqueueWhatsappOutbound({
        kind: 'template',
        templateName: m.templateName,
        language: m.language,
        parameters: m.parameters,
        recipientPhone: m.recipientPhone,
        recipientUserId: m.recipientUserId,
        appointmentId: m.appointmentId,
        source: 'manual_panel',
        sentById: actorId,
      });
      return {
        jobId,
        templateName: m.templateName,
        language: m.language,
        recipientUserId: m.recipientUserId,
      };
    }
    case 'RESCHEDULE':
      return (
        (await sendAppointmentRescheduled({ appointmentId: ctx.id, ...opts })).find(
          (o) => o.recipientUserId === ctx.patient.id,
        ) ?? null
      );
    case 'CANCELLATION':
      return sendAppointmentCancelled({ appointmentId: ctx.id, ...opts });
    case 'ARRIVAL':
      return sendArrivalConfirmation({
        patientId: ctx.patient.id,
        appointmentIds: [ctx.id],
        ...opts,
      });
    case 'CUSTOM':
      return sendCustomMessage({
        patientId: ctx.patient.id,
        appointmentId: ctx.id,
        text: customText ?? '',
        ...opts,
      });
  }
}

export interface ManualMessageOption {
  type: ManualMessageType;
  /** The exact final text (null = could not compose — the UI disables Send). */
  preview: string | null;
  lastSentAt: Date | null;
}

export interface ManualMessageOptions {
  hasPatient: boolean;
  hasPhone: boolean;
  language: LanguagePref;
  patientFirstName: string;
  /** The custom frame with `{{1}}`/`{{2}}` intact — the panel substitutes live. */
  customFrame: string | null;
  customApproved: boolean;
  options: ManualMessageOption[];
}

/** Everything the panel section needs: applicable types with their rendered
 *  previews and duplicate-guard timestamps. Read-only. */
export async function getManualMessageOptions(
  appointmentId: string,
): Promise<ManualMessageOptions> {
  const ctx = await loadManualContext(appointmentId);
  const empty: ManualMessageOptions = {
    hasPatient: false,
    hasPhone: false,
    language: 'AR',
    patientFirstName: '',
    customFrame: null,
    customApproved: false,
    options: [],
  };
  if (!ctx?.patient) return empty;
  const patient = ctx.patient;
  const hasPhone = Boolean(patient.phone);
  const customApproved = await isTemplateApproved(CUSTOM_MESSAGE_TEMPLATE, patient.languagePref);
  const types = applicableManualTypes({
    status: ctx.status,
    startsAt: ctx.startsAt,
    durationMinutes: ctx.durationMinutes,
    checkedInAt: ctx.checkedInAt,
    hasPatient: true,
    hasPhone,
    customApproved,
  });
  const options: ManualMessageOption[] = [];
  for (const type of types) {
    const lastSentAt = await lastSentOfType(ctx.id, type);
    if (type === 'CUSTOM') {
      options.push({ type, preview: null, lastSentAt });
      continue;
    }
    const composed = await composeForType(type, { ...ctx, patient }).catch(() => null);
    const preview = composed ? await renderTemplatePreview(composed) : null;
    options.push({ type, preview, lastSentAt });
  }
  return {
    hasPatient: true,
    hasPhone,
    language: patient.languagePref,
    patientFirstName: patientFirstName(patient),
    customFrame: customApproved
      ? await templateFrame(CUSTOM_MESSAGE_TEMPLATE, patient.languagePref)
      : null,
    customApproved,
    options,
  };
}

export interface ManualSendArgs {
  appointmentId: string;
  type: ManualMessageType;
  customText?: string;
  /** The action layer's duplicate check already ran: true when an earlier
   *  send of this type existed and the user confirmed "Send again". */
  resend: boolean;
  actorId: string;
}

export interface ManualSendResult {
  appointmentId: string;
  type: ManualMessageType;
  jobId: string | null;
  templateName: string;
  language: LanguagePref;
  sentAt: Date;
  resend: boolean;
  /** Automatic rows of the same type closed by this send (decision 5). */
  closedDispatch: number;
}

/**
 * THE manual send (decisions 4–8). Re-validates applicability server-side,
 * sends through the shared sender with `force` + `manual_panel`, then
 * closes any open automatic dispatch of the same type. Audited as
 * MANUAL_MESSAGE_SENT with the acting user (Act-As → the effective user is
 * captured by the decorator). The custom text lives on the message row,
 * not in the audit payload.
 */
export const sendManualAppointmentMessage = withAudit<[ManualSendArgs], ManualSendResult>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].appointmentId,
    extractAfter: (r) => ({
      event: 'MANUAL_MESSAGE_SENT',
      appointmentId: r.appointmentId,
      type: r.type,
      templateName: r.templateName,
      lang: r.language,
      resend: r.resend,
      closedDispatch: r.closedDispatch,
    }),
  },
  async function sendManualInner(args): Promise<ManualSendResult> {
    const ctx = await loadManualContext(args.appointmentId);
    if (!ctx) throw new ManualSendError('APPOINTMENT_NOT_FOUND');
    if (!ctx.patient) throw new ManualSendError('NO_PATIENT');
    if (!ctx.patient.phone) throw new ManualSendError('NO_PHONE');
    const patient = ctx.patient;

    const customApproved =
      args.type === 'CUSTOM'
        ? await isTemplateApproved(CUSTOM_MESSAGE_TEMPLATE, patient.languagePref)
        : false;
    if (args.type === 'CUSTOM' && !customApproved) {
      throw new ManualSendError('CUSTOM_TEMPLATE_PENDING');
    }
    const applicable = isManualTypeApplicable(args.type, {
      status: ctx.status,
      startsAt: ctx.startsAt,
      durationMinutes: ctx.durationMinutes,
      checkedInAt: ctx.checkedInAt,
      hasPatient: true,
      hasPhone: true,
      customApproved,
    });
    if (!applicable) throw new ManualSendError('TYPE_NOT_APPLICABLE');

    let customText: string | undefined;
    if (args.type === 'CUSTOM') {
      const v = validateCustomText(args.customText ?? '');
      if (!v.ok) {
        throw new ManualSendError(
          v.reason === 'EMPTY' ? 'CUSTOM_TEXT_EMPTY' : 'CUSTOM_TEXT_TOO_LONG',
        );
      }
      customText = v.text;
    }

    const outcome = await sendForType(args.type, { ...ctx, patient }, args.actorId, customText);
    if (!outcome) throw new ManualSendError('NOTHING_TO_SEND');

    // Decision 5 — the automatic path for this type must never fire later.
    // Decision 6 — the P17 reminder job itself is untouched.
    const dispatchType = DISPATCH_TYPE_BY_MANUAL[args.type];
    const closed = dispatchType
      ? await closeOpenDispatchForManualSend({ appointmentId: ctx.id, type: dispatchType }).catch(
          (err: unknown) => {
            console.error('[manual] dispatch close failed', err);
            return { closed: 0 };
          },
        )
      : { closed: 0 };

    return {
      appointmentId: ctx.id,
      type: args.type,
      jobId: outcome.jobId,
      templateName: outcome.templateName,
      language: outcome.language,
      sentAt: new Date(),
      resend: args.resend,
      closedDispatch: closed.closed,
    };
  },
);
