import 'server-only';

import { db } from '@/lib/db';

export interface SessionNoteRow {
  id: string;
  appointmentId: string;
  patientId: string;
  therapistId: string;
  therapistFullNameEn: string;
  therapistFullNameAr: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  painScore: number | null;
  measurementsText: string;
  parentNoteId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** True when the row was created within the last 24 hours. */
  isWithinEditWindow: boolean;
  addenda: SessionNoteRow[];
}

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function selectShape() {
  return {
    id: true,
    appointmentId: true,
    patientId: true,
    therapistId: true,
    subjective: true,
    objective: true,
    assessment: true,
    plan: true,
    painScore: true,
    measurements: true,
    parentNoteId: true,
    createdAt: true,
    updatedAt: true,
    therapist: { select: { fullNameEn: true, fullNameAr: true } },
  } as const;
}

function shape(
  row: NonNullable<Awaited<ReturnType<typeof db.sessionNote.findUnique>>> & {
    therapist: { fullNameEn: string; fullNameAr: string };
    measurements: unknown;
  },
): Omit<SessionNoteRow, 'addenda'> {
  const m = row.measurements as { text?: string } | null;
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    patientId: row.patientId,
    therapistId: row.therapistId,
    therapistFullNameEn: row.therapist.fullNameEn,
    therapistFullNameAr: row.therapist.fullNameAr,
    subjective: row.subjective,
    objective: row.objective,
    assessment: row.assessment,
    plan: row.plan,
    painScore: row.painScore,
    measurementsText: m?.text ?? '',
    parentNoteId: row.parentNoteId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isWithinEditWindow: Date.now() - row.createdAt.getTime() <= EDIT_WINDOW_MS,
  };
}

export async function getSessionNoteById(id: string): Promise<SessionNoteRow | null> {
  const row = await db.sessionNote.findUnique({
    where: { id },
    select: selectShape(),
  });
  if (!row) return null;
  return { ...shape(row), addenda: [] };
}

export async function getPrimaryNoteForAppointment(
  appointmentId: string,
): Promise<SessionNoteRow | null> {
  const row = await db.sessionNote.findFirst({
    where: { appointmentId, parentNoteId: null },
    select: selectShape(),
  });
  if (!row) return null;
  const addenda = await db.sessionNote.findMany({
    where: { parentNoteId: row.id },
    orderBy: { createdAt: 'asc' },
    select: selectShape(),
  });
  return {
    ...shape(row),
    addenda: addenda.map((a) => ({ ...shape(a), addenda: [] })),
  };
}

export async function listSessionNotesForPatient(patientId: string): Promise<SessionNoteRow[]> {
  // Fetch primaries first; addenda are nested under their primary in
  // the second query.
  const primaries = await db.sessionNote.findMany({
    where: { patientId, parentNoteId: null },
    orderBy: { createdAt: 'desc' },
    select: selectShape(),
  });
  if (primaries.length === 0) return [];
  const primaryIds = primaries.map((p) => p.id);
  const addenda = await db.sessionNote.findMany({
    where: { parentNoteId: { in: primaryIds } },
    orderBy: { createdAt: 'asc' },
    select: selectShape(),
  });
  const addendaByParent = new Map<string, SessionNoteRow[]>();
  for (const a of addenda) {
    const shaped = { ...shape(a), addenda: [] };
    const arr = addendaByParent.get(a.parentNoteId ?? '') ?? [];
    arr.push(shaped);
    addendaByParent.set(a.parentNoteId ?? '', arr);
  }
  return primaries.map((p) => ({
    ...shape(p),
    addenda: addendaByParent.get(p.id) ?? [],
  }));
}

/**
 * Therapist dashboard widget: appointments completed by the actor that
 * still have no session note. The state-machine wire-up means
 * COMPLETED-without-note is now an Admin-override edge case, but we
 * surface anything we find here so the gap is visible.
 */
export async function listAppointmentsPendingNote(
  therapistId: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    patientId: string;
    patientFullNameEn: string;
    patientFullNameAr: string;
    startsAt: Date;
    durationMinutes: number;
  }>
> {
  const rows = await db.appointment.findMany({
    where: {
      therapistId,
      status: 'COMPLETED',
      sessionNotes: { none: { parentNoteId: null } },
    },
    orderBy: { startsAt: 'desc' },
    take: limit,
    select: {
      id: true,
      patientId: true,
      startsAt: true,
      durationMinutes: true,
      patient: { select: { fullNameEn: true, fullNameAr: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    patientId: r.patientId,
    patientFullNameEn: r.patient.fullNameEn,
    patientFullNameAr: r.patient.fullNameAr,
    startsAt: r.startsAt,
    durationMinutes: r.durationMinutes,
  }));
}
