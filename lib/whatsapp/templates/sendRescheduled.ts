import { db } from '@/lib/db';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { clinicDateKey, clinicHm } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

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
export async function sendAppointmentRescheduled(args: { appointmentId: string }): Promise<void> {
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

  const recipients = appt.patient
    ? [appt.patient]
    : (appt.groupPatients ?? []).map((g) => g.patient);
  if (recipients.length === 0) return; // patient-less EVENT

  const tz = await getClinicTimeZone();
  const dateStr = clinicDateKey(appt.startsAt, tz);
  const timeStr = clinicHm(appt.startsAt, tz);
  const firstTherapist = appt.therapists?.[0]?.therapist ?? null;

  for (const p of recipients) {
    if (!p.whatsappReachable || !p.phone) continue;
    const isAr = p.languagePref === 'AR';
    const patientName = isAr ? p.fullNameAr : p.fullNameEn;
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
    void enqueueWhatsappOutbound({
      kind: 'template',
      templateName: TEMPLATE_NAME,
      language: p.languagePref,
      parameters: [patientName, dateStr, timeStr, clinician],
      recipientPhone: p.phone,
      recipientUserId: p.id,
      appointmentId: appt.id,
      source: 'queue',
    }).catch((err: unknown) => {
      console.error('[appointments.reschedule] notification enqueue failed', err);
    });
  }
}
