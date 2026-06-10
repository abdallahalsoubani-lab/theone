/**
 * Dev-only one-shot: book a single appointment for sara.k@example.com,
 * far enough in the future that a conflict-free slot is easy to find.
 * Mirrors createAppointmentInner minus the `auth()` gate (no CLI session)
 * and minus the audit wrapper. Picks an offset days ahead at 13:00 UTC
 * (inside business hours) and skips Friday.
 *
 *   pnpm dotenv -e .env.local -- tsx scripts/book-sara-appointment.ts [daysAhead]
 *
 * Run alongside the BullMQ workers so the enqueued reminder + outbound
 * confirmation jobs are observable in real time.
 */

import { AppointmentStatus } from '@prisma/client';

import { checkConflicts } from '@/lib/appointments/conflicts';
import { db } from '@/lib/db';
import { enqueueAppointmentReminder } from '@/lib/queue/jobs/appointmentReminder';

async function main() {
  const daysAhead = Number.parseInt(process.argv[2] ?? '3', 10);
  console.log('[book] looking up sara.k@example.com…');
  const patient = await db.user.findFirst({
    where: { email: 'sara.k@example.com' },
    select: {
      id: true,
      fullNameEn: true,
      fullNameAr: true,
      phone: true,
      whatsappReachable: true,
      languagePref: true,
    },
  });
  if (!patient) throw new Error('patient sara.k@example.com not found');
  console.log('[book] patient:', patient);

  const therapist = await db.user.findFirst({
    where: { role: 'THERAPIST', deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true },
  });
  if (!therapist) throw new Error('no therapist found');
  console.log('[book] therapist:', therapist);

  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  if (!admin) throw new Error('no admin found for createdById');

  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { defaultReminderOffsetMinutes: true },
  });
  const offsetMinutes = settings?.defaultReminderOffsetMinutes ?? 30;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const CLOSED_UTC_DAYS = new Set([5]); // Fri
  let candidate = new Date(Date.now() + daysAhead * DAY_MS);
  candidate.setUTCHours(13, 0, 0, 0);
  while (CLOSED_UTC_DAYS.has(candidate.getUTCDay())) {
    candidate = new Date(candidate.getTime() + DAY_MS);
  }
  const startsAt = candidate;
  console.log('[book] target slot (UTC):', startsAt.toISOString());

  const conflicts = await checkConflicts({
    patientId: patient.id,
    therapistId: therapist.id,
    startsAt,
    durationMinutes: 45,
  });
  if (!conflicts.ok) {
    console.error('[book] conflicts detected — pick another slot:', conflicts.conflicts);
    process.exit(2);
  }

  const appointment = await db.appointment.create({
    data: {
      patientId: patient.id,
      therapistId: therapist.id,
      startsAt,
      durationMinutes: 45,
      status: AppointmentStatus.SCHEDULED,
      createdById: admin.id,
    },
  });
  console.log('[book] appointment created id=', appointment.id);

  const jobId = await enqueueAppointmentReminder({
    appointmentId: appointment.id,
    startsAt: appointment.startsAt,
    reminderOffsetMinutes: offsetMinutes,
  });
  console.log('[book] reminder enqueued jobId=', jobId);

  // Inline copy of the createAppointment confirmation fan-out so the
  // script exercises the same payload shape as the live service.
  if (patient.whatsappReachable) {
    const { enqueueWhatsappOutbound } = await import('@/lib/queue/jobs/whatsappOutbound');
    const dateStr = appointment.startsAt.toISOString().slice(0, 10);
    const timeStr = appointment.startsAt.toISOString().slice(11, 16);
    const patientName = patient.languagePref === 'AR' ? patient.fullNameAr : patient.fullNameEn;
    const therapistName =
      patient.languagePref === 'AR' ? therapist.fullNameAr : therapist.fullNameEn;
    await enqueueWhatsappOutbound({
      kind: 'template',
      templateName: 'appointment_confirmation_v2',
      language: patient.languagePref,
      parameters: [patientName, therapistName, dateStr, timeStr],
      recipientPhone: patient.phone,
      recipientUserId: patient.id,
      appointmentId: appointment.id,
      source: 'queue',
    });
    console.log('[book] confirmation enqueued (provider will pick it up)');
  } else {
    console.log('[book] patient not whatsappReachable — confirmation skipped');
  }

  await db.$disconnect();
  // Force-exit so BullMQ's open Redis connection doesn't hold the
  // process. The queue object is created lazily on import.
  setTimeout(() => process.exit(0), 500).unref();
}

main().catch((err) => {
  console.error('[book] failed:', err);
  process.exit(1);
});
