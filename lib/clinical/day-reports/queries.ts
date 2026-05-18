import 'server-only';

import { AppointmentStatus } from '@prisma/client';

import { db } from '@/lib/db';

export interface DayReportRow {
  id: string;
  therapistId: string;
  therapistFullNameEn: string;
  therapistFullNameAr: string;
  date: Date;
  overallSummary: string;
  patientEntries: Array<{ patientId: string; appointmentId: string; note: string }>;
  submittedAt: Date;
}

function shape(row: {
  id: string;
  therapistId: string;
  therapist: { fullNameEn: string; fullNameAr: string };
  date: Date;
  overallSummary: string;
  patientEntries: unknown;
  submittedAt: Date;
}): DayReportRow {
  return {
    id: row.id,
    therapistId: row.therapistId,
    therapistFullNameEn: row.therapist.fullNameEn,
    therapistFullNameAr: row.therapist.fullNameAr,
    date: row.date,
    overallSummary: row.overallSummary,
    patientEntries:
      (row.patientEntries as Array<{
        patientId: string;
        appointmentId: string;
        note: string;
      }> | null) ?? [],
    submittedAt: row.submittedAt,
  };
}

export async function getDayReport(args: {
  therapistId: string;
  date: Date;
}): Promise<DayReportRow | null> {
  const row = await db.dayReport.findUnique({
    where: { therapistId_date: { therapistId: args.therapistId, date: args.date } },
    select: {
      id: true,
      therapistId: true,
      date: true,
      overallSummary: true,
      patientEntries: true,
      submittedAt: true,
      therapist: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return row ? shape(row) : null;
}

/**
 * Default entries for today: every COMPLETED appointment belonging to
 * the therapist with a pre-filled note placeholder. The form starts
 * with these and the therapist edits in place.
 */
export async function buildDayReportDraft(args: { therapistId: string; date: Date }): Promise<{
  patientEntries: Array<{
    appointmentId: string;
    patientId: string;
    patientFullNameEn: string;
    patientFullNameAr: string;
    note: string;
  }>;
  existing: DayReportRow | null;
}> {
  const existing = await getDayReport(args);
  const start = new Date(args.date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const appts = await db.appointment.findMany({
    where: {
      therapistId: args.therapistId,
      status: AppointmentStatus.COMPLETED,
      startsAt: { gte: start, lt: end },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      patientId: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });

  const existingByAppt = new Map(
    existing?.patientEntries.map((e) => [e.appointmentId, e.note]) ?? [],
  );

  const patientEntries = appts.map((a) => ({
    appointmentId: a.id,
    patientId: a.patientId,
    patientFullNameEn: a.patient.fullNameEn,
    patientFullNameAr: a.patient.fullNameAr,
    note: existingByAppt.get(a.id) ?? 'Completed session. See session note for details.',
  }));

  return { patientEntries, existing };
}

/**
 * Doctor weekly review feed: every DayReport row across the last 7 days
 * for therapists treating one of this doctor's patients. Grouped by
 * patient at the call site for display.
 */
export async function listDayReportsForDoctorWeek(args: {
  doctorId: string;
  weekStarting: Date;
}): Promise<DayReportRow[]> {
  const start = new Date(args.weekStarting);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  const rows = await db.dayReport.findMany({
    where: { date: { gte: start, lt: end } },
    orderBy: { date: 'desc' },
    select: {
      id: true,
      therapistId: true,
      date: true,
      overallSummary: true,
      patientEntries: true,
      submittedAt: true,
      therapist: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map(shape);
}
