import { AppointmentStatus, type CancellationCategory } from '@prisma/client';

import { db } from '@/lib/db';

import { cached } from './cache';

/**
 * Analytics queries (Prompt 11 §4.2). Each function returns the
 * shape the corresponding Recharts widget consumes — no further
 * transformation needed at render time.
 *
 * Every query goes through `cached(...)`; a write invalidates by
 * letting the TTL expire (5 minutes), which is acceptable for the
 * single-clinic launch traffic profile.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export interface UtilizationRow {
  bookedMinutes: number;
  availableMinutes: number;
  utilizationPct: number;
}

/**
 * Booked-vs-available time for the clinic (or a single therapist).
 * Available minutes are derived from `ClinicSettings.businessHours`
 * multiplied by therapist headcount.
 */
export async function getUtilization(
  range: DateRange,
  therapistId?: string,
): Promise<UtilizationRow> {
  return cached(
    { name: 'getUtilization', args: { from: range.from, to: range.to, therapistId } },
    async () => {
      const appts = await db.appointment.findMany({
        where: {
          startsAt: { gte: range.from, lte: range.to },
          status: {
            in: [
              AppointmentStatus.SCHEDULED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS,
              AppointmentStatus.COMPLETED,
            ],
          },
          ...(therapistId ? { therapistId } : {}),
        },
        select: { durationMinutes: true },
      });
      const bookedMinutes = appts.reduce((acc, a) => acc + a.durationMinutes, 0);
      const availableMinutes = await estimateAvailableMinutes(range, therapistId);
      const utilizationPct =
        availableMinutes > 0 ? Math.round((bookedMinutes / availableMinutes) * 100) : 0;
      return { bookedMinutes, availableMinutes, utilizationPct };
    },
  );
}

export interface NoShowRow {
  noShowCount: number;
  finishedCount: number;
  noShowPct: number;
}

export async function getNoShowRate(range: DateRange): Promise<NoShowRow> {
  return cached({ name: 'getNoShowRate', args: { from: range.from, to: range.to } }, async () => {
    const [noShow, finished] = await Promise.all([
      db.appointment.count({
        where: {
          startsAt: { gte: range.from, lte: range.to },
          status: AppointmentStatus.NO_SHOW,
        },
      }),
      db.appointment.count({
        where: {
          startsAt: { gte: range.from, lte: range.to },
          status: {
            in: [
              AppointmentStatus.COMPLETED,
              AppointmentStatus.CANCELLED,
              AppointmentStatus.NO_SHOW,
            ],
          },
        },
      }),
    ]);
    const noShowPct = finished > 0 ? Math.round((noShow / finished) * 100) : 0;
    return { noShowCount: noShow, finishedCount: finished, noShowPct };
  });
}

export interface DiagnosisRow {
  diagnosis: string;
  count: number;
}

export async function getTopDiagnoses(limit: number, range: DateRange): Promise<DiagnosisRow[]> {
  return cached(
    { name: 'getTopDiagnoses', args: { limit, from: range.from, to: range.to } },
    async () => {
      const rows = await db.treatmentPlan.groupBy({
        by: ['diagnosisPrimary'],
        where: { createdAt: { gte: range.from, lte: range.to } },
        _count: true,
      });
      return rows
        .map((r) => ({
          diagnosis: normalizeDiagnosis(r.diagnosisPrimary),
          count: r._count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    },
  );
}

export interface ReferralRow {
  source: string;
  count: number;
}

export async function getReferralSources(range: DateRange): Promise<ReferralRow[]> {
  return cached(
    { name: 'getReferralSources', args: { from: range.from, to: range.to } },
    async () => {
      const rows = await db.adultIntakeData.groupBy({
        by: ['referralSource'],
        where: { createdAt: { gte: range.from, lte: range.to } },
        _count: true,
      });
      return rows
        .filter((r) => r.referralSource !== null)
        .map((r) => ({ source: String(r.referralSource), count: r._count }))
        .sort((a, b) => b.count - a.count);
    },
  );
}

export async function getActivePatientCount(): Promise<number> {
  return cached(
    { name: 'getActivePatientCount' },
    async () => {
      const rows = await db.treatmentPlan.findMany({
        where: { status: 'ACTIVE' },
        select: { patientId: true },
        distinct: ['patientId'],
      });
      return rows.length;
    },
    15 * 60,
  );
}

export interface TrendBucket {
  month: string; // YYYY-MM
  booked: number;
  completed: number;
  cancelled: number;
}

export async function getMonthlyTrend(months: number): Promise<TrendBucket[]> {
  return cached({ name: 'getMonthlyTrend', args: { months } }, async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const rows = await db.appointment.findMany({
      where: { startsAt: { gte: start } },
      select: { startsAt: true, status: true },
    });
    const buckets = new Map<string, TrendBucket>();
    for (let i = 0; i < months; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets.set(key, { month: key, booked: 0, completed: 0, cancelled: 0 });
    }
    for (const a of rows) {
      const key = `${a.startsAt.getFullYear()}-${String(a.startsAt.getMonth() + 1).padStart(
        2,
        '0',
      )}`;
      const b = buckets.get(key);
      if (!b) continue;
      b.booked++;
      if (a.status === AppointmentStatus.COMPLETED) b.completed++;
      if (a.status === AppointmentStatus.CANCELLED) b.cancelled++;
    }
    return Array.from(buckets.values());
  });
}

export async function getComplianceAverage(range: DateRange): Promise<number> {
  return cached(
    { name: 'getComplianceAverage', args: { from: range.from, to: range.to } },
    async () => {
      const sinceDays = 7;
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      const items = await db.homeProgramItem.findMany({
        where: { active: true },
        select: {
          id: true,
          daysOfWeek: true,
          completions: {
            where: { completedAt: { gte: since } },
            select: { id: true },
          },
        },
      });
      if (items.length === 0) return 0;
      const rates = items.map((i) => {
        // Expected sessions per week == number of scheduled weekdays.
        const expected = i.daysOfWeek.length;
        if (expected <= 0) return 0;
        return Math.min(1, i.completions.length / expected);
      });
      const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
      return Math.round(avg * 100);
    },
  );
}

export interface CancellationCategoryRow {
  category: CancellationCategory;
  count: number;
}

export async function getCancellationCategories(
  range: DateRange,
): Promise<CancellationCategoryRow[]> {
  return cached(
    { name: 'getCancellationCategories', args: { from: range.from, to: range.to } },
    async () => {
      const rows = await db.appointment.groupBy({
        by: ['cancellationCategory'],
        where: {
          status: AppointmentStatus.CANCELLED,
          startsAt: { gte: range.from, lte: range.to },
        },
        _count: true,
      });
      return rows
        .filter((r) => r.cancellationCategory !== null)
        .map((r) => ({
          category: r.cancellationCategory as CancellationCategory,
          count: r._count,
        }))
        .sort((a, b) => b.count - a.count);
    },
  );
}

// ─── Per-role widgets (Prompt 11 §4.2.2 / §4.2.3) ─────────────────────────

export interface ComplianceTrendPoint {
  date: string; // YYYY-MM-DD
  rate: number; // 0-100
}

/**
 * 30-day compliance trend for the patients a Doctor is responsible for
 * (active treatment plans). One point per day, completed-vs-expected
 * across that day's scheduled home-program items.
 */
export async function getComplianceTrendForDoctor(
  doctorId: string,
  days = 30,
): Promise<ComplianceTrendPoint[]> {
  return cached({ name: 'getComplianceTrendForDoctor', args: { doctorId, days } }, async () => {
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const completions = await db.homeProgramCompletion.findMany({
      where: {
        completedAt: { gte: since },
        item: {
          patient: { patientProfile: { careTeam: { some: { clinicianId: doctorId } } } },
        },
      },
      select: { completedAt: true, scheduledDate: true },
    });

    const buckets = new Map<string, { done: number; expected: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      buckets.set(toDateKey(d), { done: 0, expected: 0 });
    }
    for (const c of completions) {
      const key = toDateKey(c.scheduledDate);
      const b = buckets.get(key);
      if (!b) continue;
      b.expected++;
      if (c.completedAt) b.done++;
    }
    return Array.from(buckets.entries()).map(([date, b]) => ({
      date,
      rate: b.expected > 0 ? Math.round((b.done / b.expected) * 100) : 0,
    }));
  });
}

export interface ScheduleDensityRow {
  day: string; // localized weekday label set by the caller; we return YYYY-MM-DD
  minutes: number;
}

/**
 * This-week schedule density for a single therapist. One bar per day
 * Sun..Sat with total booked minutes.
 */
export async function getScheduleDensityForTherapist(
  therapistId: string,
): Promise<ScheduleDensityRow[]> {
  return cached(
    { name: 'getScheduleDensityForTherapist', args: { therapistId } },
    async () => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);

      const rows = await db.appointment.findMany({
        where: {
          therapists: { some: { therapistId } },
          startsAt: { gte: start, lt: end },
          status: {
            in: [
              AppointmentStatus.SCHEDULED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS,
              AppointmentStatus.COMPLETED,
            ],
          },
        },
        select: { startsAt: true, durationMinutes: true },
      });

      const buckets = new Map<string, number>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        buckets.set(toDateKey(d), 0);
      }
      for (const a of rows) {
        const key = toDateKey(a.startsAt);
        buckets.set(key, (buckets.get(key) ?? 0) + a.durationMinutes);
      }
      return Array.from(buckets.entries()).map(([day, minutes]) => ({ day, minutes }));
    },
    60, // shorter TTL — schedule churns more than aggregates
  );
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface DayHours {
  open: string;
  close: string;
  closed: boolean;
}

async function estimateAvailableMinutes(range: DateRange, therapistId?: string): Promise<number> {
  const [settings, therapistCount] = await Promise.all([
    db.clinicSettings.findUnique({
      where: { id: 'default' },
      select: { businessHours: true },
    }),
    therapistId
      ? Promise.resolve(1)
      : db.user.count({
          where: { role: { in: ['THERAPIST', 'DOCTOR'] }, deletedAt: null },
        }),
  ]);
  const hours = (settings?.businessHours ?? null) as Record<string, DayHours> | null;
  if (!hours) return 0;

  const dayKeys: Array<keyof typeof hours> = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let perDayMinutes = 0;
  for (const key of dayKeys) {
    const day = hours[key];
    if (!day || day.closed) continue;
    perDayMinutes += diffMinutes(day.open, day.close);
  }
  const avgPerDay = perDayMinutes / 7;
  const days = Math.max(
    1,
    Math.ceil((range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000)),
  );
  return Math.round(avgPerDay * days * Math.max(1, therapistCount));
}

function diffMinutes(open: string, close: string): number {
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  return (ch ?? 0) * 60 + (cm ?? 0) - ((oh ?? 0) * 60 + (om ?? 0));
}

/**
 * Light normalization so "Lower back pain" and "lower back pain" don't
 * fragment the top-diagnoses chart. Locale-insensitive lowercase is
 * intentional — clinic diagnoses are typed in EN by clinical staff.
 */
function normalizeDiagnosis(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}
