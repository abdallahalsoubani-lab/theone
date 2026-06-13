import { type Prisma, type WaitlistStatus } from '@prisma/client';

import { clinicDayRange } from '@/lib/arrivals/time';
import { db } from '@/lib/db';

import { expirePastWaitlistEntries } from './services';
import type { WaitlistStatusFilter } from './schemas';

/**
 * Waitlist management rows (Prompt 19 §3). Phone is included ONLY for the
 * "all" scope (Secretary / Admin); Doctor (read scope) gets it nulled — same
 * phone-privacy rule as the patient list (Prompt 15 §1).
 */
export interface WaitlistRow {
  id: string;
  patientId: string;
  patientNameEn: string;
  patientNameAr: string;
  phone: string | null;
  desiredDate: string; // ISO
  windowStart: string; // ISO
  windowEnd: string; // ISO
  preferredTherapistId: string | null;
  preferredTherapistNameEn: string | null;
  preferredTherapistNameAr: string | null;
  note: string | null;
  status: WaitlistStatus;
  createdAt: string; // ISO
}

const ROW_SELECT = {
  id: true,
  patientId: true,
  desiredDate: true,
  windowStart: true,
  windowEnd: true,
  preferredTherapistId: true,
  note: true,
  status: true,
  createdAt: true,
  patient: { select: { fullNameEn: true, fullNameAr: true, phone: true } },
  preferredTherapist: { select: { fullNameEn: true, fullNameAr: true } },
} satisfies Prisma.WaitlistEntrySelect;

type RawRow = Prisma.WaitlistEntryGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(e: RawRow, canSeePhone: boolean): WaitlistRow {
  return {
    id: e.id,
    patientId: e.patientId,
    patientNameEn: e.patient.fullNameEn,
    patientNameAr: e.patient.fullNameAr,
    phone: canSeePhone ? e.patient.phone : null,
    desiredDate: e.desiredDate.toISOString(),
    windowStart: e.windowStart.toISOString(),
    windowEnd: e.windowEnd.toISOString(),
    preferredTherapistId: e.preferredTherapistId,
    preferredTherapistNameEn: e.preferredTherapist?.fullNameEn ?? null,
    preferredTherapistNameAr: e.preferredTherapist?.fullNameAr ?? null,
    note: e.note,
    status: e.status,
    createdAt: e.createdAt.toISOString(),
  };
}

export interface ListWaitlistOptions {
  /** 'all' (Secretary/Admin) sees phone; 'assigned' (Doctor) does not. */
  canSeePhone: boolean;
  statusFilter: WaitlistStatusFilter;
  now?: Date;
}

/**
 * Today + upcoming waitlist entries (Prompt 19 §3). Flips passed WAITING
 * entries to EXPIRED first (lazy expiry), then lists from the clinic-local
 * start of today onward, newest-window first.
 */
export async function listWaitlistEntries(opts: ListWaitlistOptions): Promise<WaitlistRow[]> {
  const now = opts.now ?? new Date();
  await expirePastWaitlistEntries(now);

  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { timezone: true },
  });
  const tz = settings?.timezone ?? 'Asia/Amman';
  const todayStart = clinicDayRange(now, tz).start;

  const rows = await db.waitlistEntry.findMany({
    where: {
      desiredDate: { gte: todayStart },
      ...(opts.statusFilter === 'ALL' ? {} : { status: opts.statusFilter }),
    },
    orderBy: [{ windowStart: 'asc' }, { createdAt: 'asc' }],
    select: ROW_SELECT,
  });

  return rows.map((r) => toRow(r, opts.canSeePhone));
}

/**
 * Active waitlist count for the secretary/admin nav badge. Counts WAITING
 * entries whose window hasn't passed — no sweep needed (stale rows excluded
 * by the `windowEnd > now` bound).
 */
export async function countActiveWaitlist(now: Date = new Date()): Promise<number> {
  return db.waitlistEntry.count({
    where: { status: 'WAITING', windowEnd: { gt: now } },
  });
}
