import { db } from '@/lib/db';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';

import { appointmentVarContext, buildParamsFromShape, resolveTemplateShape } from './variables';
import { patientDisplayName } from '@/lib/format/patientName';

const TEMPLATE_NAME = 'appointment_rescheduled';

/**
 * The reschedule message (Prompt 48 — the send path that never existed).
 *
 * ONE shared funnel: every start-changing mutation calls this after commit;
 * no call site builds its own params. Fires the approved 4-variable
 * `appointment_rescheduled` template — {{1}} patient name, {{2}} new date,
 * {{3}} new time, {{4}} clinician — per recipient language, clinic wall time
 * (Prompt 31).
 *
 * Documented display decisions (Prompt 48 §Item-1):
 *   - Multi-therapist sessions name the FIRST assigned clinician — the same
 *     convention the confirmation message uses.
 *   - STRETCHING (patient, no therapist): the clinician slot reads
 *     «جلسة استطالة» / "Stretching session".
 *   - GROUP/WORKSHOP: every member gets the message (they all care when the
 *     session moved). EVENT has no patient — nothing to send.
 *   - Callers only invoke this on an ACTUAL start change (never on
 *     duration-only resizes or same-slot saves — owner ruling), and the
 *     bulk series path invokes it once for the targeted occurrence only.
 *
 * Best-effort like the confirmation/cancel sends: enqueue failures log and
 * never break the reschedule itself. Unreachable patients are skipped
 * (User.whatsappReachable, Prompt 8 §4.12).
 */
export async function sendAppointmentRescheduled(args: {
  appointmentId: string;
  /** P59 — outbox Send: bypass the stale whatsappReachable flag (see
   *  sendAppointmentConfirmation). Phone-less recipients are still skipped
   *  (a group message must not abort over one member). */
  force?: boolean;
}): Promise<void> {
  const appt = await db.appointment.findUnique({
    where: { id: args.appointmentId },
    include: {
      patient: {
        select: {
          id: true,
          phone: true,
          languagePref: true,
          whatsappReachable: true,
          fullNameEn: true,
          fullNameAr: true,
        },
      },
      groupPatients: {
        include: {
          patient: {
            select: {
              id: true,
              phone: true,
              languagePref: true,
              whatsappReachable: true,
              fullNameEn: true,
              fullNameAr: true,
            },
          },
        },
      },
      therapists: {
        include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
      },
    },
  });
  if (!appt) return;
  // P53 belt: the deferred worker may fire after a cancel raced the queue
  // removal — a terminal appointment never gets a reschedule notice.
  if (appt.status !== 'SCHEDULED' && appt.status !== 'CONFIRMED') {
    console.warn(`[lifecycle] appointment ${args.appointmentId} status=${appt.status} — skipped`);
    return;
  }

  const recipients = appt.patient
    ? [appt.patient]
    : (appt.groupPatients ?? []).map((g) => g.patient);
  if (recipients.length === 0) return; // patient-less EVENT

  const firstTherapist = appt.therapists?.[0]?.therapist ?? null;

  for (const p of recipients) {
    if ((!p.whatsappReachable && !args.force) || !p.phone) continue;
    const isAr = p.languagePref === 'AR';
    const patientName = patientDisplayName(p.fullNameEn, p.fullNameAr, isAr ? 'ar' : 'en');
    const clinician = firstTherapist
      ? isAr
        ? firstTherapist.fullNameAr
        : firstTherapist.fullNameEn
      : appt.appointmentType === 'STRETCHING'
        ? isAr
          ? 'جلسة استطالة'
          : 'Stretching session'
        : isAr
          ? 'فريق العيادة'
          : 'the clinic team';
    // Prompt 48b: parameters come from the registry shape (legacy P48
    // 4-var today; the v2 [patient, dayName, date, time] after the switch).
    const shape = await resolveTemplateShape(TEMPLATE_NAME, p.languagePref);
    if (!shape) {
      console.error('[appointments.reschedule] no variable shape for template — skipping');
      continue;
    }
    const ctx = await appointmentVarContext({
      startsAt: appt.startsAt,
      patientName,
      therapistName: clinician,
      language: p.languagePref,
    });
    void enqueueWhatsappOutbound({
      kind: 'template',
      templateName: TEMPLATE_NAME,
      language: p.languagePref,
      parameters: buildParamsFromShape(shape, ctx),
      recipientPhone: p.phone,
      recipientUserId: p.id,
      appointmentId: appt.id,
      source: 'queue',
    }).catch((err: unknown) => {
      console.error('[appointments.reschedule] notification enqueue failed', err);
    });
  }
}
