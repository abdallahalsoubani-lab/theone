import 'server-only';

import { PlanStatus, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Treatment plan queries.
 *
 * Page-level fetches that join the related rows the UI renders in one
 * shot (patient, doctor, therapist, exercises). Versioned plans are
 * walked via parentPlanId; the version chain is exposed as a flat list
 * sorted oldest-first for the version history viewer.
 */

export interface PlanCardRow {
  id: string;
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  doctorId: string;
  doctorFullNameEn: string;
  doctorFullNameAr: string;
  assignedTherapistId: string;
  therapistFullNameEn: string;
  therapistFullNameAr: string;
  diagnosisPrimary: string;
  diagnosisSecondary: string | null;
  goalsShortTerm: string;
  goalsLongTerm: string;
  frequencyPerWeek: number;
  durationWeeks: number;
  status: PlanStatus;
  version: number;
  parentPlanId: string | null;
  therapistNotes: string | null;
  proposalReason: string | null;
  rejectedReason: string | null;
  approvedAt: Date | null;
  approvedById: string | null;
  createdAt: Date;
  exercises: Array<{
    id: string;
    exerciseId: string;
    exerciseNameEn: string;
    exerciseNameAr: string;
    sets: number;
    reps: number;
    durationSeconds: number;
    customNotes: string | null;
    order: number;
  }>;
}

function planSelect() {
  return {
    id: true,
    patientId: true,
    doctorId: true,
    assignedTherapistId: true,
    diagnosisPrimary: true,
    diagnosisSecondary: true,
    goalsShortTerm: true,
    goalsLongTerm: true,
    frequencyPerWeek: true,
    durationWeeks: true,
    status: true,
    version: true,
    parentPlanId: true,
    therapistNotes: true,
    proposalReason: true,
    rejectedReason: true,
    approvedAt: true,
    approvedById: true,
    createdAt: true,
    patient: { select: { fullNameEn: true, fullNameAr: true } },
    doctor: { select: { fullNameEn: true, fullNameAr: true } },
    assignedTherapist: { select: { fullNameEn: true, fullNameAr: true } },
    exercises: {
      orderBy: { order: 'asc' as const },
      select: {
        id: true,
        exerciseId: true,
        sets: true,
        reps: true,
        durationSeconds: true,
        customNotes: true,
        order: true,
        exercise: { select: { nameEn: true, nameAr: true } },
      },
    },
  } as const;
}

function shape(row: NonNullable<Awaited<ReturnType<typeof loadPlanRow>>>): PlanCardRow {
  return {
    id: row.id,
    patientId: row.patientId,
    patientFullNameEn: row.patient.fullNameEn,
    patientFullNameAr: row.patient.fullNameAr,
    doctorId: row.doctorId,
    doctorFullNameEn: row.doctor.fullNameEn,
    doctorFullNameAr: row.doctor.fullNameAr,
    assignedTherapistId: row.assignedTherapistId,
    therapistFullNameEn: row.assignedTherapist.fullNameEn,
    therapistFullNameAr: row.assignedTherapist.fullNameAr,
    diagnosisPrimary: row.diagnosisPrimary,
    diagnosisSecondary: row.diagnosisSecondary,
    goalsShortTerm: row.goalsShortTerm,
    goalsLongTerm: row.goalsLongTerm,
    frequencyPerWeek: row.frequencyPerWeek,
    durationWeeks: row.durationWeeks,
    status: row.status,
    version: row.version,
    parentPlanId: row.parentPlanId,
    therapistNotes: row.therapistNotes,
    proposalReason: row.proposalReason,
    rejectedReason: row.rejectedReason,
    approvedAt: row.approvedAt,
    approvedById: row.approvedById,
    createdAt: row.createdAt,
    exercises: row.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      exerciseNameEn: e.exercise.nameEn,
      exerciseNameAr: e.exercise.nameAr,
      sets: e.sets,
      reps: e.reps,
      durationSeconds: e.durationSeconds,
      customNotes: e.customNotes,
      order: e.order,
    })),
  };
}

async function loadPlanRow(id: string) {
  return db.treatmentPlan.findUnique({ where: { id }, select: planSelect() });
}

export async function getPlanById(id: string): Promise<PlanCardRow | null> {
  const row = await loadPlanRow(id);
  return row ? shape(row) : null;
}

/**
 * Active plan + the latest pending proposal (if any) for a patient.
 * Used by the Patient File "Treatment plan" tab to show both at once.
 */
export interface PatientPlanState {
  active: PlanCardRow | null;
  proposal: PlanCardRow | null;
  history: PlanCardRow[];
}

export async function getPatientPlanState(patientId: string): Promise<PatientPlanState> {
  const rows = await db.treatmentPlan.findMany({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    select: planSelect(),
  });
  const shaped = rows.map(shape);
  const active = shaped.find((p) => p.status === PlanStatus.ACTIVE) ?? null;
  const proposal = shaped.find((p) => p.status === PlanStatus.PROPOSED) ?? null;
  const history = shaped.filter(
    (p) => p.status !== PlanStatus.ACTIVE && p.status !== PlanStatus.PROPOSED,
  );
  return { active, proposal, history };
}

/**
 * Doctor dashboard widget: pending proposals authored by this doctor.
 */
export async function listPendingProposalsForDoctor(doctorId: string): Promise<PlanCardRow[]> {
  const rows = await db.treatmentPlan.findMany({
    where: { doctorId, status: PlanStatus.PROPOSED },
    orderBy: { createdAt: 'desc' },
    select: planSelect(),
  });
  return rows.map(shape);
}

export interface PlanListRow {
  id: string;
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  diagnosisPrimary: string;
  status: PlanStatus;
  version: number;
  frequencyPerWeek: number;
  durationWeeks: number;
  createdAt: Date;
  approvedAt: Date | null;
  proposalReason: string | null;
}

export interface PlanListResult {
  rows: PlanListRow[];
  total: number;
  countsByStatus: Record<PlanStatus, number>;
}

/**
 * Paged, filterable plan list scoped to one doctor (own authored plans).
 * Powers /doctor/plans — the index view that complements the per-plan
 * detail page and the dashboard's pending-proposal widget.
 */
export async function listPlansForDoctor(args: {
  doctorId: string;
  filters: {
    status: PlanStatus | 'ALL';
    search: string | null;
    page: number;
    pageSize: number;
  };
}): Promise<PlanListResult> {
  const { doctorId, filters } = args;
  const where: Prisma.TreatmentPlanWhereInput = { doctorId };
  if (filters.status !== 'ALL') where.status = filters.status;
  if (filters.search) {
    where.patient = {
      OR: [
        { fullNameEn: { contains: filters.search, mode: 'insensitive' } },
        { fullNameAr: { contains: filters.search } },
      ],
    };
  }
  const [rows, total, counts] = await Promise.all([
    db.treatmentPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
      select: {
        id: true,
        patientId: true,
        diagnosisPrimary: true,
        status: true,
        version: true,
        frequencyPerWeek: true,
        durationWeeks: true,
        createdAt: true,
        approvedAt: true,
        proposalReason: true,
        patient: { select: { fullNameEn: true, fullNameAr: true } },
      },
    }),
    db.treatmentPlan.count({ where }),
    db.treatmentPlan.groupBy({
      by: ['status'],
      where: { doctorId },
      _count: { _all: true },
    }),
  ]);
  const countsByStatus = Object.fromEntries(Object.values(PlanStatus).map((s) => [s, 0])) as Record<
    PlanStatus,
    number
  >;
  for (const c of counts) countsByStatus[c.status] = c._count._all;
  return {
    rows: rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      patientFullNameEn: r.patient.fullNameEn,
      patientFullNameAr: r.patient.fullNameAr,
      diagnosisPrimary: r.diagnosisPrimary,
      status: r.status,
      version: r.version,
      frequencyPerWeek: r.frequencyPerWeek,
      durationWeeks: r.durationWeeks,
      createdAt: r.createdAt,
      approvedAt: r.approvedAt,
      proposalReason: r.proposalReason,
    })),
    total,
    countsByStatus,
  };
}
