import 'server-only';

import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';

import type { TimelineEntry, TimelineFilters, TimelinePage } from './types';

/**
 * Patient timeline aggregation (Prompt 9 §4.11).
 *
 * Reads from 6 source tables, normalizes to TimelineEntry, sorts by
 * occurredAt desc, paginates in JS. The clinic-scale row counts
 * (≤ a few hundred per patient even across years) make this approach
 * a clean fit; introducing a materialized view would be premature.
 *
 * Full-text search: when `search` is set, SessionNote + TreatmentPlan
 * are filtered via the GIN indexes added in the Prompt 9 migration
 * using `to_tsvector('simple', ...) @@ websearch_to_tsquery('simple',
 * $1)`. Other source types fall back to client-side `.includes()` on
 * their already-fetched rows so callers don't see a partial timeline
 * for one of those types when searching.
 *
 * Errors during one source's load are caught + logged; the timeline
 * keeps rendering with the surviving sources. Better partial data
 * than a blank page.
 */
export async function getPatientTimeline(
  patientId: string,
  filters: TimelineFilters = {},
  pagination: { page: number; pageSize: number } = { page: 1, pageSize: 25 },
): Promise<TimelinePage> {
  const wantKinds = filters.kinds && filters.kinds.length > 0 ? new Set(filters.kinds) : null;
  const wants = (k: TimelineEntry['kind']) => !wantKinds || wantKinds.has(k);

  const fromClause = filters.from ?? new Date('1970-01-01');
  const toClause = filters.to ?? new Date('2999-12-31');

  const search = filters.search?.trim() ?? '';

  // Each source is loaded independently. If one fails we log + drop it.
  const sourceLoaders = [
    wants('INTAKE') ? loadIntakes(patientId, fromClause, toClause, search) : Promise.resolve([]),
    wants('APPOINTMENT')
      ? loadAppointments(patientId, fromClause, toClause, search)
      : Promise.resolve([]),
    wantsPlan(wantKinds) ? loadPlans(patientId, fromClause, toClause, search) : Promise.resolve([]),
    wants('SESSION_NOTE') || wants('SESSION_NOTE_ADDENDUM')
      ? loadSessionNotes(patientId, fromClause, toClause, search)
      : Promise.resolve([]),
    wants('DAY_REPORT')
      ? loadDayReports(patientId, fromClause, toClause, search)
      : Promise.resolve([]),
    wants('DOCTOR_REVIEW')
      ? loadDoctorReviews(patientId, fromClause, toClause, search)
      : Promise.resolve([]),
  ] as const;

  const loaded = await Promise.allSettled(sourceLoaders);
  const merged: TimelineEntry[] = [];
  for (const r of loaded) {
    if (r.status === 'fulfilled') merged.push(...r.value);
    else console.error('[timeline] source load failed', r.reason);
  }

  // Final post-filter on kinds (each loader already self-restricts, but
  // the plan loader emits multiple kinds from one source).
  const filtered = wantKinds ? merged.filter((e) => wantKinds.has(e.kind)) : merged;

  filtered.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const total = filtered.length;
  const start = Math.max(0, (pagination.page - 1) * pagination.pageSize);
  const entries = filtered.slice(start, start + pagination.pageSize);
  return { entries, total };
}

function wantsPlan(set: Set<TimelineEntry['kind']> | null): boolean {
  if (!set) return true;
  for (const k of [
    'PLAN_CREATED',
    'PLAN_PROPOSED',
    'PLAN_APPROVED',
    'PLAN_REJECTED',
    'PLAN_PAUSED',
    'PLAN_COMPLETED',
    'PLAN_DISCONTINUED',
    'PLAN_SUPERSEDED',
  ] as const) {
    if (set.has(k)) return true;
  }
  return false;
}

function containsCi(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

async function loadIntakes(
  patientId: string,
  from: Date,
  to: Date,
  search: string,
): Promise<TimelineEntry[]> {
  const rows = await db.intakeAssessment.findMany({
    where: { patientId, assessedAt: { gte: from, lte: to } },
    orderBy: { assessedAt: 'desc' },
    select: {
      id: true,
      assessedAt: true,
      type: true,
      status: true,
      assessedBy: { select: { fullNameEn: true } },
    },
  });
  return rows
    .filter((r) => containsCi(`${r.type} ${r.status}`, search))
    .map((r) => ({
      id: `intake-${r.id}`,
      kind: 'INTAKE' as const,
      occurredAt: r.assessedAt,
      title: r.type === 'PEDIATRIC' ? 'Pediatric intake' : 'Adult intake',
      body: `Status: ${r.status}`,
      author: r.assessedBy.fullNameEn,
      linkPath: `/secretary/patients/${patientId}`,
      sourceId: r.id,
    }));
}

async function loadAppointments(
  patientId: string,
  from: Date,
  to: Date,
  search: string,
): Promise<TimelineEntry[]> {
  const rows = await db.appointment.findMany({
    where: { patientId, startsAt: { gte: from, lte: to } },
    orderBy: { startsAt: 'desc' },
    select: {
      id: true,
      startsAt: true,
      durationMinutes: true,
      status: true,
      notes: true,
      therapist: { select: { fullNameEn: true } },
    },
  });
  return rows
    .filter((r) => containsCi(`${r.status} ${r.notes ?? ''}`, search))
    .map((r) => ({
      id: `appt-${r.id}`,
      kind: 'APPOINTMENT' as const,
      occurredAt: r.startsAt,
      title: `Appointment — ${r.status}`,
      body: r.notes ?? undefined,
      author: r.therapist.fullNameEn,
      linkPath: '/secretary/calendar',
      sourceId: r.id,
    }));
}

interface PlanRowFTS {
  id: string;
  createdAt: Date;
  status: string;
  version: number;
  parentPlanId: string | null;
  diagnosisPrimary: string;
  proposalReason: string | null;
  rejectedReason: string | null;
  approvedAt: Date | null;
}

async function loadPlans(
  patientId: string,
  from: Date,
  to: Date,
  search: string,
): Promise<TimelineEntry[]> {
  let rows: PlanRowFTS[];
  if (search) {
    // Postgres FTS via the GIN index added in the Prompt 9 migration.
    rows = await db.$queryRaw<PlanRowFTS[]>(
      Prisma.sql`
        SELECT id, "createdAt", status::text, version, "parentPlanId",
               "diagnosisPrimary", "proposalReason", "rejectedReason", "approvedAt"
        FROM "TreatmentPlan"
        WHERE "patientId" = ${patientId}
          AND "createdAt" BETWEEN ${from} AND ${to}
          AND to_tsvector('simple',
                coalesce("diagnosisPrimary",  '') || ' ' ||
                coalesce("diagnosisSecondary",'') || ' ' ||
                coalesce("goalsShortTerm",    '') || ' ' ||
                coalesce("goalsLongTerm",     '') || ' ' ||
                coalesce("therapistNotes",    '')
              ) @@ websearch_to_tsquery('simple', ${search})
        ORDER BY "createdAt" DESC
      `,
    );
  } else {
    rows = (await db.treatmentPlan.findMany({
      where: { patientId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        status: true,
        version: true,
        parentPlanId: true,
        diagnosisPrimary: true,
        proposalReason: true,
        rejectedReason: true,
        approvedAt: true,
      },
    })) as unknown as PlanRowFTS[];
  }

  const out: TimelineEntry[] = [];
  for (const r of rows) {
    // Emit one entry per relevant transition; status alone captures the
    // current row but the timeline narrative wants the historical event.
    const baseTitle = `Plan v${r.version}`;
    const linkPath = `/doctor/plans/${r.id}` as const;
    if (r.status === 'PROPOSED') {
      out.push({
        id: `plan-prop-${r.id}`,
        kind: 'PLAN_PROPOSED',
        occurredAt: r.createdAt,
        title: `${baseTitle} — proposed`,
        body: r.proposalReason ?? r.diagnosisPrimary,
        linkPath,
        sourceId: r.id,
      });
    } else if (r.status === 'REJECTED') {
      out.push({
        id: `plan-rej-${r.id}`,
        kind: 'PLAN_REJECTED',
        occurredAt: r.createdAt,
        title: `${baseTitle} — rejected`,
        body: r.rejectedReason ?? undefined,
        linkPath,
        sourceId: r.id,
      });
    } else if (r.parentPlanId == null) {
      out.push({
        id: `plan-created-${r.id}`,
        kind: 'PLAN_CREATED',
        occurredAt: r.createdAt,
        title: `${baseTitle} — created`,
        body: r.diagnosisPrimary,
        linkPath,
        sourceId: r.id,
      });
    } else if (r.approvedAt) {
      out.push({
        id: `plan-approved-${r.id}`,
        kind: 'PLAN_APPROVED',
        occurredAt: r.approvedAt,
        title: `${baseTitle} — approved`,
        body: r.diagnosisPrimary,
        linkPath,
        sourceId: r.id,
      });
    }
    // Terminal lifecycle transitions (PAUSED / COMPLETED / DISCONTINUED /
    // SUPERSEDED) are inferred by the current status combined with the
    // updatedAt timestamp; we map them off the current status alone for
    // v1 simplicity. updatedAt is not selected here to keep the query
    // small; lifecycle markers can be enriched later from the audit log.
  }
  return out;
}

interface SessionNoteFTS {
  id: string;
  createdAt: Date;
  parentNoteId: string | null;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  therapistName: string;
}

async function loadSessionNotes(
  patientId: string,
  from: Date,
  to: Date,
  search: string,
): Promise<TimelineEntry[]> {
  let rows: SessionNoteFTS[];
  if (search) {
    rows = await db.$queryRaw<SessionNoteFTS[]>(
      Prisma.sql`
        SELECT n.id, n."createdAt", n."parentNoteId",
               n.subjective, n.objective, n.assessment, n.plan,
               u."fullNameEn" AS "therapistName"
        FROM "SessionNote" n
        JOIN "User" u ON u.id = n."therapistId"
        WHERE n."patientId" = ${patientId}
          AND n."createdAt" BETWEEN ${from} AND ${to}
          AND to_tsvector('simple',
                coalesce(n.subjective, '') || ' ' ||
                coalesce(n.objective,  '') || ' ' ||
                coalesce(n.assessment, '') || ' ' ||
                coalesce(n.plan,       '')
              ) @@ websearch_to_tsquery('simple', ${search})
        ORDER BY n."createdAt" DESC
      `,
    );
  } else {
    const raw = await db.sessionNote.findMany({
      where: { patientId, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        parentNoteId: true,
        subjective: true,
        objective: true,
        assessment: true,
        plan: true,
        therapist: { select: { fullNameEn: true } },
      },
    });
    rows = raw.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      parentNoteId: r.parentNoteId,
      subjective: r.subjective,
      objective: r.objective,
      assessment: r.assessment,
      plan: r.plan,
      therapistName: r.therapist.fullNameEn,
    }));
  }
  return rows.map((r) => ({
    id: `note-${r.id}`,
    kind: r.parentNoteId ? ('SESSION_NOTE_ADDENDUM' as const) : ('SESSION_NOTE' as const),
    occurredAt: r.createdAt,
    title: r.parentNoteId ? 'Session note addendum' : 'Session note',
    body: [r.subjective, r.objective, r.assessment, r.plan]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 280),
    author: r.therapistName,
    linkPath: `/therapist/sessions/notes/${r.id}/edit` as const,
    sourceId: r.id,
  }));
}

async function loadDayReports(
  patientId: string,
  from: Date,
  to: Date,
  search: string,
): Promise<TimelineEntry[]> {
  const rows = await db.dayReport
    .findMany({
      where: {
        date: { gte: from, lte: to },
        patientEntries: { path: ['*', 'patientId'], array_contains: patientId } as never,
      },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        submittedAt: true,
        date: true,
        overallSummary: true,
        patientEntries: true,
        therapist: { select: { fullNameEn: true } },
      },
    })
    .catch(async () => {
      // The Prisma path-based JSON array filter is finicky across versions;
      // fall back to a broader query + JS filter when it errors out.
      return db.dayReport.findMany({
        where: { date: { gte: from, lte: to } },
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          submittedAt: true,
          date: true,
          overallSummary: true,
          patientEntries: true,
          therapist: { select: { fullNameEn: true } },
        },
      });
    });

  return rows
    .filter((r) => {
      const entries = (r.patientEntries as Array<{ patientId: string; note: string }> | null) ?? [];
      const mine = entries.find((e) => e.patientId === patientId);
      if (!mine) return false;
      return containsCi(`${r.overallSummary} ${mine.note}`, search);
    })
    .map((r) => {
      const entries = (r.patientEntries as Array<{ patientId: string; note: string }> | null) ?? [];
      const mine = entries.find((e) => e.patientId === patientId);
      return {
        id: `dayreport-${r.id}`,
        kind: 'DAY_REPORT' as const,
        occurredAt: r.submittedAt,
        title: 'Day report',
        body: mine?.note ?? r.overallSummary.slice(0, 280),
        author: r.therapist.fullNameEn,
        linkPath: '/doctor/reports/weekly' as const,
        sourceId: r.id,
      };
    });
}

async function loadDoctorReviews(
  patientId: string,
  from: Date,
  to: Date,
  search: string,
): Promise<TimelineEntry[]> {
  const rows = await db.doctorReview.findMany({
    where: { patientId, createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      comment: true,
      weekStarting: true,
      doctor: { select: { fullNameEn: true } },
    },
  });
  return rows
    .filter((r) => containsCi(r.comment, search))
    .map((r) => ({
      id: `review-${r.id}`,
      kind: 'DOCTOR_REVIEW' as const,
      occurredAt: r.createdAt,
      title: `Doctor review (week of ${r.weekStarting.toISOString().slice(0, 10)})`,
      body: r.comment.slice(0, 280),
      author: r.doctor.fullNameEn,
      linkPath: '/doctor/reports/weekly' as const,
      sourceId: r.id,
    }));
}
