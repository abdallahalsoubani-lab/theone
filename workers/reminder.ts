/**
 * Appointment-reminder worker.
 *
 * Started by `pnpm workers:start` — a separate Node process in production.
 * In dev it runs in the same Node process as the WhatsApp outbound worker
 * (workers/whatsapp.ts); the singleton in `lib/queue/client.ts` ensures
 * only one Redis connection.
 *
 * Job lifecycle:
 *   1. enqueueAppointmentReminder schedules ONE delayed job (Prompt 17): the
 *      appointment start minus the configured offset (default 24h), clamped to
 *      the clinic's 08:00–18:00 local reminder window.
 *   2. When the delay elapses, this worker fires
 *   3. The handler re-reads the appointment from the DB to confirm it's
 *      still active (SCHEDULED or CONFIRMED) — terminal/cancelled
 *      appointments are silently skipped
 *   4. Enqueues a `whatsappOutbound` job carrying the template name +
 *      parameters. The dedicated outbound worker (workers/whatsapp.ts)
 *      handles retries, rate limiting, audit, and reachability flips.
 *
 * Before Prompt 8, this worker called whatsapp.sendTemplate directly. The
 * outbound queue decouples the "should I send" decision (lives here, with
 * the domain model) from "did the send succeed" (lives in the outbound
 * worker, uniform across all senders). That uniformity is what lets the
 * Admin message log + resend action work for every kind of outbound.
 */

import { Worker } from 'bullmq';

import { db } from '@/lib/db';
import {
  appointmentVarContext,
  buildParamsFromShape,
  resolveTemplateShape,
} from '@/lib/whatsapp/templates/variables';
import { queueRedis } from '@/lib/queue/client';
import type { AppointmentReminderJob } from '@/lib/queue/jobs/appointmentReminder';
import { enqueueWhatsappOutbound } from '@/lib/queue/jobs/whatsappOutbound';
import { REMINDER_QUEUE } from '@/lib/queue/queues';
import { patientDisplayName } from '@/lib/format/patientName';
import { clinicDateKey } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';
import {
  formatReminderAppointments,
  reminderTime,
  type ReminderAppointment,
} from '@/lib/whatsapp/templates/reminderAppointments';
import { reminderV3Approved } from '@/lib/whatsapp/templates/approval';

/** Same-day appointment carrying its first therapist (for the v2 fallback). */
interface SameDayAppt extends ReminderAppointment {
  therapists: Array<{ therapist: { fullNameEn: string; fullNameAr: string } }>;
}

export function startReminderWorker(): Worker {
  const worker = new Worker<AppointmentReminderJob>(
    REMINDER_QUEUE,
    async (job) => {
      const { appointmentId } = job.data;
      // P53 — deferred lifecycle messages share this queue (deterministic
      // ids confirm-{id}/resched-{id}; the schedule/replace/remove logic
      // lives in lib/queue/jobs/appointmentReminder.ts). The senders
      // re-read the appointment so the patient always gets CURRENT details.
      if (
        job.data.kind === 'confirmation' ||
        job.data.kind === 'reschedule' ||
        job.data.kind === 'cancellation'
      ) {
        // P48 — every lifecycle send reports its outcome to the dispatch
        // ledger (SENT/FAILED); pre-P48 jobs without a ledger row no-op.
        const kind = job.data.kind;
        // P51 — an AUTO job scheduled while silent mode was OFF may fire
        // while it is ON: skip the send and re-park the entry for the
        // outbox. Admin-pressed sends (adminSend) are human-initiated and
        // pass through.
        if (!job.data.adminSend) {
          const { isSilentModeOn, reparkScheduled } = await import('@/lib/whatsapp/silent-mode');
          if (await isSilentModeOn()) {
            const TYPE = {
              confirmation: 'BOOKING_CONFIRMATION',
              reschedule: 'RESCHEDULE',
              cancellation: 'CANCELLATION',
            } as const;
            await reparkScheduled({ appointmentId, type: TYPE[kind] });
            return;
          }
        }
        const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
        try {
          // P59 — an admin-pressed Send must genuinely ATTEMPT the send:
          // force bypasses the (possibly stale) whatsappReachable skip, so
          // the outcome recorded is the provider's, not a silent no-op.
          const force = job.data.adminSend === true;
          if (kind === 'confirmation') {
            const { sendAppointmentConfirmation } =
              await import('@/lib/whatsapp/templates/sendConfirmation');
            await sendAppointmentConfirmation({ appointmentId, force });
          } else if (kind === 'reschedule') {
            const { sendAppointmentRescheduled } =
              await import('@/lib/whatsapp/templates/sendRescheduled');
            await sendAppointmentRescheduled({ appointmentId, force });
          } else {
            const { sendAppointmentCancelled } =
              await import('@/lib/whatsapp/templates/sendCancelled');
            await sendAppointmentCancelled({ appointmentId, force });
          }
        } catch (err) {
          await markDispatchOutcome({
            appointmentId,
            kind,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);
          throw err;
        }
        await markDispatchOutcome({ appointmentId, kind, ok: true }).catch(() => undefined);
        console.warn(`[lifecycle] appointment=${appointmentId} ${kind} dispatched`);
        return;
      }
      // P51 — outbox-sent arrival confirmation: re-derive via the same
      // sender the kiosk path uses, then report the outcome to the ledger.
      if (job.data.kind === 'arrival') {
        const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
        const row = await db.whatsAppDispatch.findFirst({
          where: { appointmentId, type: 'ARRIVAL', status: 'SCHEDULED' },
          orderBy: { createdAt: 'desc' },
          select: { patientId: true },
        });
        if (!row?.patientId) {
          console.warn(
            `[silent-mode] arrival send for ${appointmentId}: no held row/patient — skipping`,
          );
          return;
        }
        try {
          const { sendArrivalConfirmation } = await import('@/lib/whatsapp/templates/sendArrival');
          await sendArrivalConfirmation({
            patientId: row.patientId,
            appointmentIds: [appointmentId],
            // P59 — arrival jobs on this queue only exist via the outbox
            // Send button; force past the stale reachability flag.
            force: job.data.adminSend === true,
          });
        } catch (err) {
          await markDispatchOutcome({
            appointmentId,
            kind: 'arrival',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);
          throw err;
        }
        await markDispatchOutcome({ appointmentId, kind: 'arrival', ok: true }).catch(
          () => undefined,
        );
        console.warn(`[lifecycle] appointment=${appointmentId} arrival dispatched (outbox)`);
        return;
      }
      const patientSelect = {
        id: true,
        fullNameEn: true,
        fullNameAr: true,
        phone: true,
        languagePref: true,
      } as const;
      const appt = await db.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          patient: { select: patientSelect },
          // GROUP therapy / workshops (July #8 part 3): members live in the
          // M2M, so the reminder fans out one message per member (#6).
          groupPatients: { include: { patient: { select: patientSelect } } },
          therapists: {
            orderBy: { createdAt: 'asc' },
            include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
          },
        },
      });
      if (!appt) {
        console.warn(`[reminder] appointment ${appointmentId} no longer exists — skipping`);
        return;
      }
      if (appt.status === 'CANCELLED' || appt.status === 'NO_SHOW' || appt.status === 'COMPLETED') {
        console.warn(`[reminder] appointment ${appointmentId} status=${appt.status} — skipping`);
        return;
      }
      if (appt.startsAt.getTime() < Date.now()) {
        console.warn(`[reminder] appointment ${appointmentId} already past — skipping`);
        return;
      }
      // P51 — silent mode holds the reminder in the outbox INSTEAD of
      // sending (decision reversal §1.4: the owner's master switch gates
      // the P17 reminder too). Fire-time check, so toggling OFF simply
      // lets future fires send normally. Admin-pressed sends pass through.
      if (!job.data.adminSend) {
        const { isSilentModeOn, holdForOutbox } = await import('@/lib/whatsapp/silent-mode');
        if (await isSilentModeOn()) {
          await holdForOutbox({
            type: 'REMINDER',
            appointmentId: appt.id,
            patientId: appt.patientId,
          });
          return;
        }
      }
      // Recipients: a GROUP reminds every member (#6); a single-patient
      // SESSION/STRETCHING reminds the one patient; a patient-less EVENT has
      // no one to remind (July #8) and is skipped.
      const recipients =
        appt.appointmentType === 'GROUP'
          ? appt.groupPatients.map((g) => g.patient)
          : appt.patient
            ? [appt.patient]
            : [];
      if (recipients.length === 0) {
        console.warn(`[reminder] appointment ${appointmentId} has no patient — skipping`);
        return;
      }

      // P53 — one reminder per patient per clinic-day. For a single-patient
      // SESSION/STRETCHING (the only type routed through the per-patient-per-
      // day resync), gather ALL of this patient's live same-day appointments
      // and render them into ONE message: single_v3 (start time) for one,
      // multi (day summary) for two+. A GROUP fans out per member with the
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

      try {
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
              const th = da.therapists[0]?.therapist ?? null;
              const therapistName = (lang === 'AR' ? th?.fullNameAr : th?.fullNameEn) ?? '';
              const shapeV2 = await resolveTemplateShape('appointment_reminder_v2', lang);
              if (!shapeV2) {
                console.error(
                  '[reminder] no variable shape for appointment_reminder_v2 — skipping',
                );
                continue;
              }
              const ctxV2 = await appointmentVarContext({
                startsAt: da.startsAt,
                patientName: patientDisplayName(
                  recipient.fullNameEn,
                  recipient.fullNameAr,
                  rLocale,
                ),
                therapistName,
                language: lang,
              });
              const idV2 = await enqueueWhatsappOutbound({
                kind: 'template',
                templateName: 'appointment_reminder_v2',
                language: lang,
                parameters: buildParamsFromShape(shapeV2, ctxV2),
                recipientPhone: recipient.phone,
                recipientUserId: recipient.id,
                appointmentId: da.id,
                source: 'queue',
              });
              console.warn(
                `[reminder] appointment=${da.id} patient=${recipient.id} template=appointment_reminder_v2 (v3 pending) enqueued outbound=${idV2 ?? 'n/a'}`,
              );
            }
            continue;
          }

          const isSingle = dayAppts.length <= 1;
          const templateName = isSingle
            ? 'appointment_reminder_single_v3'
            : 'appointment_reminder_multi';
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
          const id = await enqueueWhatsappOutbound({
            kind: 'template',
            templateName,
            language: lang,
            parameters: buildParamsFromShape(shape, ctx),
            recipientPhone: recipient.phone,
            recipientUserId: recipient.id,
            appointmentId: appt.id,
            source: 'queue',
          });
          console.warn(
            `[reminder] appointment=${appointmentId} patient=${recipient.id} template=${templateName} count=${dayAppts.length} enqueued outbound=${id ?? 'n/a'}`,
          );
        }
      } catch (err) {
        if (job.data.adminSend) {
          const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
          await markDispatchOutcome({
            appointmentId,
            kind: 'reminder',
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }).catch(() => undefined);
        }
        throw err;
      }
      // P51 — when this fire was an outbox Send of a held reminder, report
      // the outcome to the ledger (no-op when no SCHEDULED row exists —
      // the normal silent-OFF automatic fire).
      if (job.data.adminSend) {
        const { markDispatchOutcome } = await import('@/lib/whatsapp/dispatch/outcome');
        await markDispatchOutcome({ appointmentId, kind: 'reminder', ok: true }).catch(
          () => undefined,
        );
      }
    },
    { connection: queueRedis },
  );

  worker.on('failed', (job, err) => {
    console.error(`[reminder] job ${job?.id ?? '<unknown>'} failed: ${err.message}`, err);
  });

  return worker;
}
