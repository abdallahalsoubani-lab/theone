import { AuditAction, type LanguagePref } from '@prisma/client';
import { randomUUID } from 'node:crypto';

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
import { RECIPIENT_INCLUDE, getMessageRecipients, type MessageRecipient } from './recipients';
import {
  DISPATCH_TYPE_BY_MANUAL,
  MANUAL_MESSAGE_TYPES,
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
 *
 * P61 item 1 — the unit of work is a RECIPIENT, not an appointment. Every
 * appointment with at least one patient can be messaged (multi-therapist,
 * therapist-less stretching, multi-patient group); a group send is one
 * message per patient, each in that patient's own language with their own
 * first name, sharing one `batchId`. One patient's failure never aborts the
 * rest of the batch.
 */

export type ManualSendErrorCode =
  | 'APPOINTMENT_NOT_FOUND'
  | 'NO_PATIENT'
  | 'NO_PHONE'
  | 'RECIPIENT_NOT_ON_APPOINTMENT'
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
  recipients: MessageRecipient[];
}

async function loadManualContext(appointmentId: string): Promise<ManualContext | null> {
  const appt = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      durationMinutes: true,
      checkedInAt: true,
      appointmentType: true,
      ...RECIPIENT_INCLUDE,
    },
  });
  if (!appt) return null;
  return {
    id: appt.id,
    status: appt.status,
    startsAt: appt.startsAt,
    durationMinutes: appt.durationMinutes,
    recipients: getMessageRecipients(appt),
  };
}

/** The most recent non-failed outbound of this type PER RECIPIENT — the
 *  duplicate guard's "already sent at" (decision 7, per patient since P61). */
export async function lastSentByRecipient(
  appointmentId: string,
  type: ManualMessageType,
  recipientIds: string[],
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (recipientIds.length === 0) return out;
  const rows = await db.whatsAppMessage.findMany({
    where: {
      appointmentId,
      direction: 'OUTBOUND',
      status: { not: 'FAILED' },
      recipientId: { in: recipientIds },
      template: { name: { in: [...TEMPLATE_FAMILY_BY_MANUAL[type]] } },
    },
    orderBy: { sentAt: 'desc' },
    select: { recipientId: true, sentAt: true },
  });
  for (const r of rows) {
    if (r.recipientId && !out.has(r.recipientId)) out.set(r.recipientId, r.sentAt);
  }
  return out;
}

/** Compose (never enqueue) the message the panel would send to ONE recipient. */
async function composeForType(
  type: ManualMessageType,
  ctx: ManualContext,
  recipient: MessageRecipient,
  customText?: string,
): Promise<ComposedMessage | null> {
  const forRecipient = (list: ComposedMessage[]) =>
    list.find((m) => m.recipientUserId === recipient.id) ?? null;
  switch (type) {
    case 'CONFIRMATION':
      return composeAppointmentConfirmation({
        appointmentId: ctx.id,
        recipientId: recipient.id,
        force: true,
      });
    case 'REMINDER': {
      const appt = await loadReminderAppointment(ctx.id);
      return appt ? forRecipient(await buildAppointmentReminderMessages(appt)) : null;
    }
    case 'RESCHEDULE':
      return forRecipient(
        await composeAppointmentRescheduled({ appointmentId: ctx.id, force: true }),
      );
    case 'CANCELLATION':
      return composeAppointmentCancelled({
        appointmentId: ctx.id,
        recipientId: recipient.id,
        force: true,
      });
    case 'ARRIVAL':
      return composeArrivalConfirmation({
        patientId: recipient.id,
        appointmentIds: [ctx.id],
        force: true,
      });
    case 'CUSTOM':
      return composeCustomMessage({
        patientId: recipient.id,
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
  ctx: ManualContext,
  recipient: MessageRecipient,
  actorId: string,
  customText?: string,
): Promise<SendOutcome | null> {
  const opts = { force: true, source: 'manual_panel' as const, sentById: actorId };
  switch (type) {
    case 'CONFIRMATION':
      return sendAppointmentConfirmation({
        appointmentId: ctx.id,
        recipientId: recipient.id,
        ...opts,
      });
    case 'REMINDER': {
      // The reminder has no standalone sender: the worker and this path
      // share the ONE builder and each enqueue what it returns.
      const appt = await loadReminderAppointment(ctx.id);
      if (!appt) return null;
      const m = (await buildAppointmentReminderMessages(appt)).find(
        (x) => x.recipientUserId === recipient.id,
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
          (o) => o.recipientUserId === recipient.id,
        ) ?? null
      );
    case 'CANCELLATION':
      return sendAppointmentCancelled({
        appointmentId: ctx.id,
        recipientId: recipient.id,
        ...opts,
      });
    case 'ARRIVAL':
      return sendArrivalConfirmation({
        patientId: recipient.id,
        appointmentIds: [ctx.id],
        ...opts,
      });
    case 'CUSTOM':
      return sendCustomMessage({
        patientId: recipient.id,
        appointmentId: ctx.id,
        text: customText ?? '',
        ...opts,
      });
  }
}

export interface ManualRecipientInfo {
  patientId: string;
  fullNameEn: string;
  fullNameAr: string;
  language: LanguagePref;
  firstName: string;
  hasPhone: boolean;
}

export interface ManualMessageOption {
  type: ManualMessageType;
  /** Recipients this type applies to right now (arrival is per membership). */
  applicableRecipientIds: string[];
  /** One rendered preview per distinct language among those recipients —
   *  never a language nobody receives (§1.3.2). null = could not compose. */
  previewByLanguage: Partial<Record<LanguagePref, string | null>>;
  /** patientId → last non-failed send of this type. */
  lastSentByRecipient: Record<string, Date>;
}

export interface ManualMessageOptions {
  recipients: ManualRecipientInfo[];
  /** The custom frame per language with `{{1}}`/`{{2}}` intact — the panel
   *  substitutes live. */
  customFrameByLanguage: Partial<Record<LanguagePref, string | null>>;
  customApprovedByLanguage: Record<LanguagePref, boolean>;
  options: ManualMessageOption[];
}

const EMPTY_OPTIONS: ManualMessageOptions = {
  recipients: [],
  customFrameByLanguage: {},
  customApprovedByLanguage: { AR: false, EN: false },
  options: [],
};

/** Everything the panel section needs: the recipients, the applicable types
 *  with their exact rendered previews, and the per-patient duplicate-guard
 *  timestamps. Read-only. */
export async function getManualMessageOptions(
  appointmentId: string,
): Promise<ManualMessageOptions> {
  const ctx = await loadManualContext(appointmentId);
  if (!ctx || ctx.recipients.length === 0) return EMPTY_OPTIONS;

  const languages = [...new Set(ctx.recipients.map((r) => r.languagePref))];
  const customApprovedByLanguage: Record<LanguagePref, boolean> = { AR: false, EN: false };
  for (const lang of languages) {
    customApprovedByLanguage[lang] = await isTemplateApproved(CUSTOM_MESSAGE_TEMPLATE, lang);
  }

  const applicableByRecipient = new Map<string, ManualMessageType[]>();
  for (const r of ctx.recipients) {
    applicableByRecipient.set(
      r.id,
      applicableManualTypes({
        status: ctx.status,
        startsAt: ctx.startsAt,
        durationMinutes: ctx.durationMinutes,
        checkedInAt: r.checkedInAt,
        hasPatient: true,
        hasPhone: Boolean(r.phone),
        customApproved: customApprovedByLanguage[r.languagePref],
        perPatientArrival: r.viaMembership,
      }),
    );
  }

  const options: ManualMessageOption[] = [];
  for (const type of MANUAL_MESSAGE_TYPES) {
    const applicable = ctx.recipients.filter((r) =>
      (applicableByRecipient.get(r.id) ?? []).includes(type),
    );
    if (applicable.length === 0) continue;

    const previewByLanguage: Partial<Record<LanguagePref, string | null>> = {};
    if (type !== 'CUSTOM') {
      // One compose per distinct language, using that language's first
      // recipient — the body differs per language, not per patient beyond
      // the name the panel already shows on the recipient row.
      for (const lang of [...new Set(applicable.map((r) => r.languagePref))]) {
        const sample = applicable.find((r) => r.languagePref === lang)!;
        const composed = await composeForType(type, ctx, sample).catch((err: unknown) => {
          // P61 — this used to swallow the reason entirely, leaving a dead
          // message type in the panel with nothing in the logs.
          console.error(
            `[manual] preview compose failed appointment=${ctx.id} type=${type} lang=${lang}`,
            err,
          );
          return null;
        });
        previewByLanguage[lang] = composed ? await renderTemplatePreview(composed) : null;
      }
    }

    const lastSent = await lastSentByRecipient(
      ctx.id,
      type,
      applicable.map((r) => r.id),
    );
    options.push({
      type,
      applicableRecipientIds: applicable.map((r) => r.id),
      previewByLanguage,
      lastSentByRecipient: Object.fromEntries(lastSent),
    });
  }

  const customFrameByLanguage: Partial<Record<LanguagePref, string | null>> = {};
  for (const lang of languages) {
    customFrameByLanguage[lang] = customApprovedByLanguage[lang]
      ? await templateFrame(CUSTOM_MESSAGE_TEMPLATE, lang)
      : null;
  }

  return {
    recipients: ctx.recipients.map((r) => ({
      patientId: r.id,
      fullNameEn: r.fullNameEn,
      fullNameAr: r.fullNameAr,
      language: r.languagePref,
      firstName: patientFirstName(r),
      hasPhone: Boolean(r.phone),
    })),
    customFrameByLanguage,
    customApprovedByLanguage,
    options,
  };
}

export interface ManualSendArgs {
  appointmentId: string;
  type: ManualMessageType;
  customText?: string;
  /** Defaults to every recipient of the appointment. The service re-derives
   *  the valid set and rejects an id that is not on the appointment — the UI
   *  is never trusted (§1.3.4). */
  recipientIds?: string[];
  /** The action layer's duplicate check already ran: true when an earlier
   *  send of this type existed and the user confirmed "Send again". */
  resend: boolean;
  actorId: string;
}

export interface ManualSendResult {
  appointmentId: string;
  recipientId: string;
  type: ManualMessageType;
  jobId: string | null;
  templateName: string;
  language: LanguagePref;
  sentAt: Date;
  resend: boolean;
  /** Groups every row of one group send into a single traceable action. */
  batchId: string;
  /** Automatic rows of the same type closed by this send (decision 5). */
  closedDispatch: number;
}

interface RecipientSendArgs {
  ctx: ManualContext;
  recipient: MessageRecipient;
  type: ManualMessageType;
  customText?: string;
  resend: boolean;
  actorId: string;
  batchId: string;
}

/**
 * ONE recipient's manual send — the audited unit of work. Re-validates
 * applicability server-side, sends through the shared sender with `force` +
 * `manual_panel`, then closes any open automatic dispatch of the same type
 * for that patient. Audited as MANUAL_MESSAGE_SENT with the acting user
 * (Act-As → the effective user is captured by the decorator). The custom
 * text lives on the message row, not in the audit payload.
 */
const sendManualToRecipient = withAudit<[RecipientSendArgs], ManualSendResult>(
  {
    entityType: 'Appointment',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].ctx.id,
    extractAfter: (r) => ({
      event: 'MANUAL_MESSAGE_SENT',
      appointmentId: r.appointmentId,
      recipientId: r.recipientId,
      batchId: r.batchId,
      type: r.type,
      templateName: r.templateName,
      lang: r.language,
      resend: r.resend,
      closedDispatch: r.closedDispatch,
    }),
  },
  async function sendManualInner(args): Promise<ManualSendResult> {
    const { ctx, recipient, type } = args;
    if (!recipient.phone) throw new ManualSendError('NO_PHONE');

    const customApproved =
      type === 'CUSTOM'
        ? await isTemplateApproved(CUSTOM_MESSAGE_TEMPLATE, recipient.languagePref)
        : false;
    if (type === 'CUSTOM' && !customApproved) {
      throw new ManualSendError('CUSTOM_TEMPLATE_PENDING');
    }
    const applicable = isManualTypeApplicable(type, {
      status: ctx.status,
      startsAt: ctx.startsAt,
      durationMinutes: ctx.durationMinutes,
      // Arrival is per membership for a group member (§1.2.4).
      checkedInAt: recipient.checkedInAt,
      perPatientArrival: recipient.viaMembership,
      hasPatient: true,
      hasPhone: true,
      customApproved,
    });
    if (!applicable) throw new ManualSendError('TYPE_NOT_APPLICABLE');

    const outcome = await sendForType(type, ctx, recipient, args.actorId, args.customText);
    if (!outcome) throw new ManualSendError('NOTHING_TO_SEND');

    // Decision 5 — the automatic path for this type must never fire later.
    // Decision 6 — the P17 reminder job itself is untouched.
    const dispatchType = DISPATCH_TYPE_BY_MANUAL[type];
    const closed = dispatchType
      ? await closeOpenDispatchForManualSend({
          appointmentId: ctx.id,
          type: dispatchType,
          patientId: recipient.id,
        }).catch((err: unknown) => {
          console.error('[manual] dispatch close failed', err);
          return { closed: 0 };
        })
      : { closed: 0 };

    return {
      appointmentId: ctx.id,
      recipientId: recipient.id,
      type,
      jobId: outcome.jobId,
      templateName: outcome.templateName,
      language: outcome.language,
      sentAt: new Date(),
      resend: args.resend,
      batchId: args.batchId,
      closedDispatch: closed.closed,
    };
  },
);

export type ManualRecipientOutcome =
  | { patientId: string; ok: true; result: ManualSendResult }
  | { patientId: string; ok: false; code: ManualSendErrorCode };

export interface ManualSendBatchResult {
  appointmentId: string;
  type: ManualMessageType;
  batchId: string;
  sentAt: Date;
  results: ManualRecipientOutcome[];
}

/**
 * THE manual send (decisions 4–8, P61 §1.3.4). Resolves the recipient set
 * server-side, validates the custom text once, then sends to each recipient
 * in turn under one `batchId`. A failure for one patient is recorded and the
 * rest of the batch still goes out.
 */
export async function sendManualAppointmentMessage(
  args: ManualSendArgs,
): Promise<ManualSendBatchResult> {
  const ctx = await loadManualContext(args.appointmentId);
  if (!ctx) throw new ManualSendError('APPOINTMENT_NOT_FOUND');
  if (ctx.recipients.length === 0) throw new ManualSendError('NO_PATIENT');

  // Never trust the UI: the valid set is re-derived from the appointment and
  // an id that is not on it is a hard rejection, not a silent skip.
  let targets = ctx.recipients;
  if (args.recipientIds && args.recipientIds.length > 0) {
    const wanted = new Set(args.recipientIds);
    for (const id of wanted) {
      if (!ctx.recipients.some((r) => r.id === id)) {
        throw new ManualSendError('RECIPIENT_NOT_ON_APPOINTMENT');
      }
    }
    targets = ctx.recipients.filter((r) => wanted.has(r.id));
  }
  if (targets.length === 0) throw new ManualSendError('NOTHING_TO_SEND');

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

  // Every recipient lacking a phone → the whole call is a hard NO_PHONE (the
  // panel would not have offered Send); a mixed set sends to whoever can
  // receive and reports the rest.
  if (targets.every((r) => !r.phone)) throw new ManualSendError('NO_PHONE');

  const batchId = randomUUID();
  const results: ManualRecipientOutcome[] = [];
  for (const recipient of targets) {
    try {
      const result = await sendManualToRecipient({
        ctx,
        recipient,
        type: args.type,
        customText,
        resend: args.resend,
        actorId: args.actorId,
        batchId,
      });
      results.push({ patientId: recipient.id, ok: true, result });
    } catch (err) {
      // §1.3.2 — one patient's failure must never abort the batch.
      console.error(
        `[manual] send failed appointment=${ctx.id} patient=${recipient.id} type=${args.type}`,
        err,
      );
      results.push({
        patientId: recipient.id,
        ok: false,
        code: err instanceof ManualSendError ? err.code : 'NOTHING_TO_SEND',
      });
    }
  }

  // Nothing went out at all → this is an error, not a "0 of 1 sent" report.
  // Keeps the single-recipient contract identical to P60 (the action turns it
  // into the localized failure the panel already showed).
  const firstFailure = results.find((r) => !r.ok);
  if (firstFailure && results.every((r) => !r.ok)) {
    throw new ManualSendError(firstFailure.ok ? 'NOTHING_TO_SEND' : firstFailure.code);
  }

  return {
    appointmentId: ctx.id,
    type: args.type,
    batchId,
    sentAt: new Date(),
    results,
  };
}
