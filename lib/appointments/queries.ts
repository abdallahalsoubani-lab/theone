import {
  AppointmentStatus,
  type AppointmentType,
  type CancellationCategory,
  type Prisma,
} from '@prisma/client';

import { db } from '@/lib/db';

import type { AppointmentListFilters, CancelledAppointmentFilters } from './schemas';

export interface PersonRef {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

export interface CalendarAppointment {
  id: string;
  /** Null for a patient-less EVENT (July #8 part 2). */
  patientId: string | null;
  patientFullNameEn: string;
  patientFullNameAr: string;
  /** EVENT label (null for patient bookings) — the chip title for events; the
   *  optional workshop label for a GROUP (July #8 part 3). */
  title: string | null;
  /** GROUP members (July #8 part 3) — empty for every non-GROUP type. The
   *  calendar chip shows the count + names for a group. */
  groupPatients: PersonRef[];
  /** All therapists on this session (Prompt 20) — the calendar renders the
   *  appointment in each one's resource column. */
  therapists: PersonRef[];
  roomId: string | null;
  roomName: string | null;
  /** Patient phone — present ONLY when the viewer may see contact PII
   *  (P15 §1 + P22 §3.1: Secretary/Admin yes, Doctor/Therapist null) and
   *  null for patient-less EVENTs. Renderers must render-if-present, never
   *  fetch separately (Prompt 56 §1.3). */
  patientPhone: string | null;
  startsAt: Date;
  durationMinutes: number;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  appointmentType: AppointmentType;
  notes: string | null;
  seriesId: string | null;
  /** Primary session note id, if one exists (Prompt 46 row 5 — drives the
   *  side panel's Add/Open session-report action). */
  sessionNoteId: string | null;
}

/**
 * Calendar-shaped query. Returns lean shape suitable for `react-big-calendar`
 * resource events. Caller filters by date range + optional therapist set.
 */
export async function listAppointmentsForCalendar(
  filters: AppointmentListFilters,
): Promise<CalendarAppointment[]> {
  const where: Prisma.AppointmentWhereInput = {
    startsAt: { gte: filters.from, lte: filters.to },
    ...(filters.therapistIds && filters.therapistIds.length > 0
      ? { therapists: { some: { therapistId: { in: filters.therapistIds } } } }
      : {}),
    ...(filters.patientId ? { patientId: filters.patientId } : {}),
    // Cancelled appointments no longer render on the calendar grid (July change
    // request #7) — they live only in the dedicated Cancelled view (Prompt 17).
    // When the caller asks for a specific status we honour it (keeps that
    // escape hatch, e.g. an explicit CANCELLED drill-down); otherwise we
    // exclude cancelled while leaving every other status (incl. NO_SHOW) shown.
    ...(filters.status
      ? { status: filters.status }
      : { status: { not: AppointmentStatus.CANCELLED } }),
  };

  const rows = await db.appointment.findMany({
    where,
    orderBy: { startsAt: 'asc' },
    include: {
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true, phone: true } },
      groupPatients: {
        orderBy: { createdAt: 'asc' },
        include: { patient: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      },
      therapists: {
        orderBy: { createdAt: 'asc' },
        include: { therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      },
      room: { select: { id: true, name: true } },
      // Primary note only (parentNoteId null) — addenda never gate the action.
      sessionNotes: { where: { parentNoteId: null }, select: { id: true }, take: 1 },
    },
  });

  // P15 contact boundary for the tooltip's phone row (Prompt 56): same
  // lazy-import pattern as listActivePatientsBrief. Fail-closed — a caller
  // without a session (workers, tests) ships null phones.
  const { viewerCanSeePatientContact } = await import('@/lib/patients/access');
  const canSeeContact = await viewerCanSeePatientContact();

  return rows.map((r) => ({
    id: r.id,
    patientId: r.patient?.id ?? null,
    patientFullNameEn: r.patient?.fullNameEn ?? '',
    patientFullNameAr: r.patient?.fullNameAr ?? '',
    title: r.title,
    groupPatients: r.groupPatients.map((g) => g.patient),
    therapists: r.therapists.map((t) => t.therapist),
    roomId: r.room?.id ?? null,
    roomName: r.room?.name ?? null,
    patientPhone: canSeeContact ? (r.patient?.phone ?? null) : null,
    startsAt: r.startsAt,
    durationMinutes: r.durationMinutes,
    status: r.status,
    appointmentType: r.appointmentType,
    notes: r.notes,
    seriesId: r.seriesId,
    sessionNoteId: r.sessionNotes?.[0]?.id ?? null,
  }));
}

export async function getAppointmentById(id: string) {
  return db.appointment.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true, phone: true } },
      therapists: {
        orderBy: { createdAt: 'asc' },
        include: { therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      },
      room: { select: { id: true, name: true } },
      createdBy: { select: { id: true, fullNameEn: true, fullNameAr: true } },
    },
  });
}

/**
 * Used by the appointment form's "patient picker" to populate the searchable
 * select. Returns active patients only, name + phone for display. Phone is
 * nulled out for Doctor viewers (Prompt 15 §1) — the picker shows name only
 * for them; Secretary/Admin keep the phone to disambiguate same-name patients.
 */
export async function listActivePatientsBrief() {
  const { viewerCanSeePatientPhone } = await import('@/lib/patients/access');
  const { pendingFirstVisitIds } = await import('@/lib/patients/first-visit');
  const canSeePhone = await viewerCanSeePatientPhone();
  // NO cap (P52 incident): a silent take:200 + EN-name ordering hid every
  // patient past rank 200 from the pickers once the 257 imports (empty
  // fullNameEn sorts first) landed — the client-side picker can only find
  // what reaches it. Single-clinic scale ruling (CLAUDE.md: a few hundred
  // active patients) makes the full roster a few tens of KB. Ordered by
  // ARABIC name — the clinic's primary script.
  const rows = await db.user.findMany({
    where: { role: 'PATIENT', deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true, phone: true },
    orderBy: { fullNameAr: 'asc' },
  });
  // Doctor-first-visit soft flag (Prompt 41 — NI-5): one batch query for the
  // whole list so the booking modal can show its informational notice.
  const pending = await pendingFirstVisitIds(rows.map((r) => r.id));
  return rows.map((r) => ({
    ...r,
    phone: canSeePhone ? r.phone : null,
    pendingFirstVisit: pending.has(r.id),
  }));
}

/**
 * Active clinical staff (therapists + doctors) — fills the resource column
 * list on the calendar and the therapist picker in the appointment form.
 */
export async function listActiveClinicians() {
  return db.user.findMany({
    where: { role: { in: ['THERAPIST', 'DOCTOR'] }, deletedAt: null },
    select: { id: true, fullNameEn: true, fullNameAr: true, role: true },
    orderBy: { fullNameEn: 'asc' },
  });
}

export interface CancelledAppointmentRow {
  id: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  /** Null for Doctor viewers — phone hidden (Prompt 15 §1). */
  patientPhone: string | null;
  startsAt: Date;
  durationMinutes: number;
  therapists: { fullNameEn: string; fullNameAr: string }[];
  roomName: string | null;
  cancellationReason: string | null;
  cancellationCategory: CancellationCategory | null;
  cancellationNotes: string | null;
  cancelledByFullNameEn: string | null;
  cancelledByFullNameAr: string | null;
  cancelledAt: Date | null;
}

/**
 * Paginated list of cancelled appointments (Prompt 17). Filtered + sorted by
 * cancellation time (newest first). Phone is nulled for viewers who can't see
 * it (Doctor) — pass canSeePhone from the page based on the viewer's role.
 */
export async function listCancelledAppointments(args: {
  filters: CancelledAppointmentFilters;
  canSeePhone: boolean;
}): Promise<{ rows: CancelledAppointmentRow[]; total: number }> {
  const { filters, canSeePhone } = args;
  const where: Prisma.AppointmentWhereInput = {
    status: AppointmentStatus.CANCELLED,
    // Patient-centric view — never lists patient-less EVENTs (July #8).
    patientId: { not: null },
    ...(filters.from || filters.to
      ? {
          cancelledAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
    ...(filters.therapistId ? { therapists: { some: { therapistId: filters.therapistId } } } : {}),
    ...(filters.search
      ? {
          patient: {
            OR: [
              { fullNameEn: { contains: filters.search, mode: 'insensitive' } },
              { fullNameAr: { contains: filters.search } },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.appointment.findMany({
      where,
      orderBy: { cancelledAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      include: {
        patient: { select: { fullNameEn: true, fullNameAr: true, phone: true } },
        therapists: {
          orderBy: { createdAt: 'asc' },
          include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
        },
        room: { select: { name: true } },
        cancelledBy: { select: { fullNameEn: true, fullNameAr: true } },
      },
    }),
    db.appointment.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((r) => ({
      id: r.id,
      patientFullNameEn: r.patient?.fullNameEn ?? '',
      patientFullNameAr: r.patient?.fullNameAr ?? '',
      patientPhone: canSeePhone ? (r.patient?.phone ?? null) : null,
      startsAt: r.startsAt,
      durationMinutes: r.durationMinutes,
      therapists: r.therapists.map((t) => t.therapist),
      roomName: r.room?.name ?? null,
      cancellationReason: r.cancellationReason,
      cancellationCategory: r.cancellationCategory,
      cancellationNotes: r.cancellationNotes,
      cancelledByFullNameEn: r.cancelledBy?.fullNameEn ?? null,
      cancelledByFullNameAr: r.cancelledBy?.fullNameAr ?? null,
      cancelledAt: r.cancelledAt,
    })),
  };
}

// ── Patient-file Appointments tab (Prompt 33 — NI-2) ────────────────────────

export interface PatientFileAppointment {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  appointmentType: AppointmentType;
  /** Workshop/event label (GROUP/EVENT bookings). */
  title: string | null;
  therapists: PersonRef[];
  roomName: string | null;
  /** Prompt 48 — the file-row reschedule action needs the series scope. */
  seriesId: string | null;
}

/**
 * Every appointment on a patient's file — both their own bookings
 * (Appointment.patientId) and GROUP sessions they are a member of via the
 * AppointmentPatient M2M (July #8 part 3). No phone or any other patient
 * contact field in the shape, so the tab is safe for every role that can
 * open the file (Prompt 15 privacy). Ordered newest-first; the tab splits
 * upcoming vs past itself.
 */
export async function listAppointmentsForPatientFile(
  patientId: string,
): Promise<PatientFileAppointment[]> {
  const rows = await db.appointment.findMany({
    where: {
      OR: [{ patientId }, { groupPatients: { some: { patientId } } }],
    },
    orderBy: { startsAt: 'desc' },
    select: {
      id: true,
      startsAt: true,
      durationMinutes: true,
      status: true,
      appointmentType: true,
      title: true,
      seriesId: true,
      room: { select: { name: true } },
      therapists: {
        orderBy: { createdAt: 'asc' },
        select: { therapist: { select: { id: true, fullNameEn: true, fullNameAr: true } } },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    durationMinutes: r.durationMinutes,
    status: r.status,
    appointmentType: r.appointmentType,
    title: r.title,
    therapists: r.therapists.map((t) => t.therapist),
    roomName: r.room?.name ?? null,
    seriesId: r.seriesId,
  }));
}

// ── Doctor-dashboard "my appointments today" (PT-B1 item 2) ──

export interface ClinicTodayAppointment {
  id: string;
  startsAt: Date;
  status: AppointmentStatus;
  checkedInAt: Date | null;
  patientId: string | null;
  /** EVENT/GROUP label when there is no scalar patient. */
  title: string | null;
  patient: { fullNameEn: string; fullNameAr: string } | null;
  therapists: Array<{ fullNameEn: string; fullNameAr: string }>;
}

/**
 * ONE clinician's appointments for the clinic-local day bounded by
 * [dayStart, dayEnd). Doctors are bookable clinicians (they get calendar
 * resource lanes), so "my appointments" means the rows where this user is an
 * assigned clinician in the AppointmentTherapist M2M.
 *
 * `clinicianId` always comes from the server session — never a request
 * parameter, so one clinician can't ask for another's day (PT-B1 item 2,
 * reversing the Prompt 39 clinic-wide ruling). The clinic-wide view still
 * exists as the calendar itself.
 *
 * Cancelled rows are excluded, matching the calendar; therapist names are
 * included so co-treated sessions read correctly; no phone.
 */
export async function listTodayAppointmentsForClinician(args: {
  clinicianId: string;
  dayStart: Date;
  dayEnd: Date;
}): Promise<ClinicTodayAppointment[]> {
  const rows = await db.appointment.findMany({
    where: {
      therapists: { some: { therapistId: args.clinicianId } },
      startsAt: { gte: args.dayStart, lt: args.dayEnd },
      status: { not: AppointmentStatus.CANCELLED },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      status: true,
      checkedInAt: true,
      patientId: true,
      title: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
      therapists: {
        orderBy: { createdAt: 'asc' },
        select: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    status: r.status,
    checkedInAt: r.checkedInAt,
    patientId: r.patientId,
    title: r.title,
    patient: r.patient,
    therapists: r.therapists.map((t) => t.therapist),
  }));
}
