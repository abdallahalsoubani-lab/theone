import type { LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { patientDisplayName } from '@/lib/format/patientName';
import { clinicDateKey } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

import { reminderV3Approved } from './approval';
import { formatReminderAppointments, reminderTime } from './reminderAppointments';
import { getAppointmentTherapistLabel } from './therapistLabel';
import type { ComposedMessage } from './types';
import { appointmentVarContext, buildParamsFromShape, resolveTemplateShape } from './variables';

/**
 * P60 — the ONE reminder composer, shared by the P17 reminder worker and the
 * manual "Send a message" panel. Extracted verbatim from workers/reminder.ts
 * so template selection (single_v3 / multi / v2-per-appointment fallback)
 * and the P53 one-message-per-patient-per-day rendering live in exactly one
 * place.
 *
 * The worker keeps its own pre-checks (status / past / silent-mode hold)
 * before calling in; the manual path validates applicability server-side.
 */

const PATIENT_SELECT = {
  id: true,
  fullNameEn: true,
  fullNameAr: true,
  phone: true,
  languagePref: true,
} as const;

export interface ReminderPatient {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  phone: string | null;
  languagePref: LanguagePref;
}

interface TherapistRef {
  therapist: { fullNameEn: string; fullNameAr: string };
}

export interface ReminderAppointmentRow {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  status: string;
  appointmentType: string;
  patientId: string | null;
  patient: ReminderPatient | null;
  groupPatients: Array<{ patient: ReminderPatient }>;
  therapists: TherapistRef[];
}

/** Same-day appointment carrying its first therapist (for the v2 fallback). */
interface SameDayAppt {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  /** P61 — drives the therapist-less fallback wording. */
  appointmentType: string;
  therapists: TherapistRef[];
}

/** Load the appointment with everything the reminder needs (one query). */
export async function loadReminderAppointment(
  appointmentId: string,
): Promise<ReminderAppointmentRow | null> {
  return db.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { select: PATIENT_SELECT },
      // GROUP therapy / workshops (July #8 part 3): members live in the
      // M2M, so the reminder fans out one message per member (#6).
      groupPatients: { include: { patient: { select: PATIENT_SELECT } } },
      therapists: {
        orderBy: { createdAt: 'asc' },
        include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
      },
    },
  });
}

/**
 * Compose the reminder message(s) for one appointment: a GROUP reminds
 * every member (its own appointment only, single_v3); a single-patient
 * SESSION/STRETCHING renders ALL of the patient's live same-day
 * appointments into ONE message (single_v3 for one, multi for two+). While
 * the v3 pair is not approved for the language, falls back to exactly the
 * legacy behaviour: one `appointment_reminder_v2` per appointment.
 *
 * Recipients without a phone are skipped (logged, ids only). Never checks
 * whatsappReachable — the reminder path never did (P57 report, E-7).
 */
export async function buildAppointmentReminderMessages(
  appt: ReminderAppointmentRow,
): Promise<ComposedMessage[]> {
  const recipients =
    appt.appointmentType === 'GROUP'
      ? appt.groupPatients.map((g) => g.patient)
      : appt.patient
        ? [appt.patient]
        : [];
  if (recipients.length === 0) {
    console.warn(`[reminder] appointment ${appt.id} has no patient — skipping`);
    return [];
  }

  // P53 — one reminder per patient per clinic-day. For a single-patient
  // SESSION/STRETCHING (the only type routed through the per-patient-per-
  // day resync), gather ALL of this patient's live same-day appointments
  // and render them into ONE message. A GROUP fans out per member with the
  // single_v3 template (one time each) — its own appointment only.
  const clinicTz = await getClinicTimeZone();
  const isGroupReminder = appt.appointmentType === 'GROUP';
  const sameDayByPatient = new Map<string, SameDayAppt[]>();
  if (!isGroupReminder && appt.patient) {
    const dayKey = clinicDateKey(appt.startsAt, clinicTz);
    const dayStartUtc = new Date(appt.startsAt.getTime() - 24 * 60 * 60 * 1000);
    const dayEndUtc = new Date(appt.startsAt.getTime() + 24 * 60 * 60 * 1000);
    const sameDay = await db.appointment.findMany({
      where: {
        patientId: appt.patient.id,
        appointmentType: { in: ['SESSION', 'STRETCHING'] },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { gte: dayStartUtc, lte: dayEndUtc },
      },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        appointmentType: true,
        therapists: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
        },
      },
    });
    sameDayByPatient.set(
      appt.patient.id,
      sameDay.filter((a) => clinicDateKey(a.startsAt, clinicTz) === dayKey),
    );
  }

  const messages: ComposedMessage[] = [];
  for (const recipient of recipients) {
    // P50: phone is optional now — skip cleanly and log (the pattern
    // mirrors the P29 patient-less EVENT skip above).
    if (!recipient.phone) {
      console.warn(
        `[reminder] patient=${recipient.id} has no phone — skipping reminder for appointment=${appt.id}`,
      );
      continue;
    }
    const lang = recipient.languagePref;
    const rLocale = lang === 'AR' ? 'ar' : 'en';
    const anchorAsSameDay: SameDayAppt = {
      id: appt.id,
      startsAt: appt.startsAt,
      durationMinutes: appt.durationMinutes,
      appointmentType: appt.appointmentType,
      therapists: appt.therapists,
    };
    // The day's appointments for THIS recipient (group members render
    // only their group appointment).
    const dayAppts: SameDayAppt[] = isGroupReminder
      ? [anchorAsSameDay]
      : (sameDayByPatient.get(recipient.id) ?? [anchorAsSameDay]);

    // P52/P53 deploy — the v3 one-per-day templates only work once
    // WhatsApp APPROVES them (a pending template fails to send). Until
    // then fall back to EXACTLY today's behaviour: one legacy
    // `appointment_reminder_v2` message PER appointment (no regression
    // in coverage). The daily approval-sync flips this automatically.
    const useV3 = await reminderV3Approved(lang);

    if (!useV3) {
      for (const da of dayAppts) {
        // P61 — this used to fall back to an EMPTY string when the
        // appointment had no therapist (STRETCHING), and Twilio rejects empty
        // template parameters. Same shared label as every other sender.
        const therapistName = getAppointmentTherapistLabel({
          therapists: da.therapists,
          language: lang,
          appointmentType: da.appointmentType,
        });
        const shapeV2 = await resolveTemplateShape('appointment_reminder_v2', lang);
        if (!shapeV2) {
          console.error('[reminder] no variable shape for appointment_reminder_v2 — skipping');
          continue;
        }
        const ctxV2 = await appointmentVarContext({
          startsAt: da.startsAt,
          patientName: patientDisplayName(recipient.fullNameEn, recipient.fullNameAr, rLocale),
          therapistName,
          language: lang,
        });
        messages.push({
          templateName: 'appointment_reminder_v2',
          language: lang,
          parameters: buildParamsFromShape(shapeV2, ctxV2),
          recipientPhone: recipient.phone,
          recipientUserId: recipient.id,
          appointmentId: da.id,
        });
      }
      continue;
    }

    const isSingle = dayAppts.length <= 1;
    const templateName = isSingle ? 'appointment_reminder_single_v3' : 'appointment_reminder_multi';
    const reminderBody = isSingle
      ? reminderTime(dayAppts[0]!.startsAt, rLocale)
      : formatReminderAppointments(dayAppts, rLocale);

    const shape = await resolveTemplateShape(templateName, lang);
    if (!shape) {
      console.error(`[reminder] no variable shape for ${templateName} — skipping`);
      continue;
    }
    const ctx = {
      ...(await appointmentVarContext({
        startsAt: appt.startsAt,
        patientName: patientDisplayName(recipient.fullNameEn, recipient.fullNameAr, rLocale),
        therapistName: '',
        language: lang,
      })),
      reminderBody,
    };
    messages.push({
      templateName,
      language: lang,
      parameters: buildParamsFromShape(shape, ctx),
      recipientPhone: recipient.phone,
      recipientUserId: recipient.id,
      appointmentId: appt.id,
    });
  }
  return messages;
}
