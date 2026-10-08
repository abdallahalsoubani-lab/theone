import type { Gender, LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';
import { patientDisplayName } from '@/lib/format/patientName';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { clinicHm } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';
import { normalizeCustomText } from '@/lib/whatsapp/manual/customText';

import { isTemplateApproved } from './approval';
import { userFirstName } from './firstName';
import { CUSTOM_MESSAGE_TEMPLATE } from './sendCustomMessage';
import type { ComposedMessage, SendOutcome } from './types';
import { buildParamsFromShape, resolveTemplateShape } from './variables';

/**
 * P62 — "your patient has arrived": an INTERNAL WhatsApp alert to every
 * clinician assigned to the appointment(s) a patient just checked in for.
 *
 * Fired from the one arrival seam (`lib/arrivals/notify-arrival.ts`) right
 * after the patient's own arrival confirmation — kiosk and secretary manual
 * check-in both land there, one call per arrival (a back-to-back run is one
 * arrival, so a clinician with two adjacent slots gets ONE message listing
 * both times).
 *
 * Owner decisions (08/10):
 *   - Recipients are the staff rows the appointment is assigned to, with
 *     whatever phone the system holds. **No phone on file → no alert**, no
 *     error — the secretary fills the number in later from /admin/users.
 *   - Staff-bound = internal: this path never consults the silent mode, the
 *     P48 dispatch modes, or the outbox. Only patient-bound messages are
 *     policy-gated.
 *   - Until a dedicated template is approved, the alert rides inside the
 *     approved `clinic_custom_message` frame («مرحباً {{1}}، رسالة من المركز
 *     الأول…{{2}}»): {{1}} = the CLINICIAN's first name, {{2}} = the alert
 *     text built here. Swapping to a dedicated template later is this file
 *     only.
 *
 * `User.whatsappReachable` is deliberately IGNORED for staff: the flag is a
 * patient-triage signal with a patient-profile reset UI; nothing else ever
 * messages staff, so a single bad day would otherwise silence a clinician's
 * alerts forever. A genuinely wrong number surfaces as FAILED rows in the
 * admin message log instead.
 */

interface ComposeArgs {
  /** The patient who arrived (scalar patient of a SESSION/STRETCHING run). */
  patientId: string;
  /** The appointments this one arrival covers, in any order. */
  appointmentIds: string[];
}

const STAFF_RECIPIENT_SELECT = {
  id: true,
  phone: true,
  languagePref: true,
  fullNameEn: true,
  fullNameAr: true,
  deletedAt: true,
} as const;

/**
 * Pure: the `{{2}}` text in the clinician's language. The patient name is
 * the clinic-wide display name (English wins, Arabic as the P47 fallback) —
 * the same label the clinician sees on the calendar. Times are clinic-wall
 * HH:mm, ascending; an adjacent run lists them all in one sentence.
 */
export function buildStaffArrivalText(args: {
  patientName: string;
  patientGender: Gender | null;
  times: readonly string[];
  language: LanguagePref;
}): string {
  const times = [...new Set(args.times)];
  const name = args.patientName.trim();
  if (args.language === 'AR') {
    const female = args.patientGender === 'FEMALE';
    const subject = female ? `وصلت المريضة ${name}` : `وصل المريض ${name}`;
    if (times.length === 0) return `${subject}.`;
    if (times.length === 1) {
      return `${subject} ${female ? 'لموعدها' : 'لموعده'} الساعة ${times[0]}.`;
    }
    return `${subject} ${female ? 'لمواعيدها' : 'لمواعيده'} الساعة ${times.join(' و')}.`;
  }
  const subject = `Your patient ${name} has arrived`;
  if (times.length === 0) return `${subject}.`;
  if (times.length === 1) return `${subject} for the ${times[0]} appointment.`;
  const joined = `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
  return `${subject} for the ${joined} appointments.`;
}

interface StaffEntry {
  staff: {
    id: string;
    phone: string | null;
    languagePref: LanguagePref;
    fullNameEn: string;
    fullNameAr: string;
  };
  times: string[];
  /** The earliest appointment of the run for this clinician anchors the log row. */
  anchorAppointmentId: string;
}

/**
 * Composition: one message per assigned clinician who has a phone on file.
 * Reads only; the caller enqueues. Returns [] when the patient or the
 * appointments are gone (a stale kiosk anchor) — never throws for data gaps.
 */
export async function composeStaffArrivalAlerts(args: ComposeArgs): Promise<ComposedMessage[]> {
  if (args.appointmentIds.length === 0) return [];

  const [patient, appointments, tz] = await Promise.all([
    db.user.findUnique({
      where: { id: args.patientId },
      select: {
        fullNameEn: true,
        fullNameAr: true,
        patientProfile: { select: { gender: true } },
      },
    }),
    db.appointment.findMany({
      where: { id: { in: args.appointmentIds } },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        startsAt: true,
        therapists: {
          orderBy: { createdAt: 'asc' },
          select: { therapist: { select: STAFF_RECIPIENT_SELECT } },
        },
      },
    }),
    getClinicTimeZone(),
  ]);
  if (!patient || appointments.length === 0) return [];

  // Group the run by clinician: a therapist on two adjacent slots is alerted
  // once, with both times.
  const byStaff = new Map<string, StaffEntry>();
  for (const appt of appointments) {
    const hm = clinicHm(appt.startsAt, tz);
    for (const { therapist } of appt.therapists) {
      if (therapist.deletedAt) continue;
      const entry = byStaff.get(therapist.id) ?? {
        staff: therapist,
        times: [],
        anchorAppointmentId: appt.id,
      };
      entry.times.push(hm);
      byStaff.set(therapist.id, entry);
    }
  }

  const patientName = patientDisplayName(patient.fullNameEn, patient.fullNameAr);
  const patientGender = patient.patientProfile?.gender ?? null;
  const approvedByLanguage = new Map<LanguagePref, boolean>();
  const shapeByLanguage = new Map<LanguagePref, Awaited<ReturnType<typeof resolveTemplateShape>>>();

  const out: ComposedMessage[] = [];
  for (const entry of byStaff.values()) {
    const { staff } = entry;
    // Owner rule: no phone on the staff row → nothing to send, silently.
    if (!staff.phone) continue;

    const lang = staff.languagePref;
    if (!approvedByLanguage.has(lang)) {
      approvedByLanguage.set(lang, await isTemplateApproved(CUSTOM_MESSAGE_TEMPLATE, lang));
    }
    if (!approvedByLanguage.get(lang)) {
      console.error(
        `[staff-arrival] ${CUSTOM_MESSAGE_TEMPLATE}/${lang} not approved — skipping alert for user=${staff.id}`,
      );
      continue;
    }
    if (!shapeByLanguage.has(lang)) {
      shapeByLanguage.set(lang, await resolveTemplateShape(CUSTOM_MESSAGE_TEMPLATE, lang));
    }
    const shape = shapeByLanguage.get(lang) ?? null;
    if (!shape) {
      console.error('[staff-arrival] no variable shape for the custom-message template — skipping');
      continue;
    }

    out.push({
      templateName: CUSTOM_MESSAGE_TEMPLATE,
      language: lang,
      parameters: buildParamsFromShape(shape, {
        patientName: userFirstName(staff),
        customText: normalizeCustomText(
          buildStaffArrivalText({ patientName, patientGender, times: entry.times, language: lang }),
        ),
        therapistName: '',
        date: '',
        time: '',
        dayName: '',
      }),
      recipientPhone: staff.phone,
      recipientUserId: staff.id,
      appointmentId: entry.anchorAppointmentId,
    });
  }
  return out;
}

/**
 * Enqueue one alert per composed clinician on the outbound queue (retries,
 * rate limiting, and the `WhatsAppMessage` log are the worker's job — never
 * inline). Automatic by definition: source `queue`, no acting staff member.
 */
export async function sendStaffArrivalAlerts(args: ComposeArgs): Promise<SendOutcome[]> {
  const composed = await composeStaffArrivalAlerts(args);
  const outcomes: SendOutcome[] = [];
  for (const c of composed) {
    const jobId = await enqueueWhatsappOutbound({
      kind: 'template',
      templateName: c.templateName,
      language: c.language,
      parameters: c.parameters,
      recipientPhone: c.recipientPhone,
      recipientUserId: c.recipientUserId,
      appointmentId: c.appointmentId,
      source: 'queue',
      sentById: null,
    });
    outcomes.push({
      jobId,
      templateName: c.templateName,
      language: c.language,
      recipientUserId: c.recipientUserId,
    });
  }
  return outcomes;
}
