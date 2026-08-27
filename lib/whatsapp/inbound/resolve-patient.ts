import { AppointmentStatus, UserRole } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * P57 — THE single rule for "which patient does an inbound message from a
 * shared phone belong to". A parent's number can be registered on several
 * children (P50 dropped patient-phone uniqueness), so `recipientId` on
 * `WhatsAppMessage` — and everything downstream that copies it: the
 * `InboxItem`, the `WhatsAppConversation.patientId` link, and therefore the
 * P56 attachment rows hanging off the message — must be resolved by ONE
 * deterministic rule, in one place. Never re-derive this elsewhere.
 *
 * Rule (owner-approved, Prompt 57 §4):
 *   1. 0 active patients on the phone → null; exactly 1 → that patient
 *      (fast path — no appointment queries, identical to the pre-P50 path).
 *   2. Several → the patient with the NEAREST ACTIVE appointment: status in
 *      {SCHEDULED, CONFIRMED, IN_PROGRESS} whose scheduled end has not
 *      passed; smallest `startsAt` wins. Tie (siblings booked at the same
 *      minute): prefer the appointment a reminder was actually sent for
 *      (48b outbound linkage), then the older patient record (createdAt
 *      asc), then id asc.
 *   3. Else the MOST RECENTLY ACTIVE patient: latest `startsAt` among the
 *      patient's non-cancelled appointments (any past status); holders with
 *      no appointment at all rank below those with one. Tie → `User.updatedAt`
 *      desc → id asc. If nobody has an appointment → updatedAt desc → id asc.
 */
export const INBOUND_ACTIVE_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
];

/** How far back an "active" appointment may have started and still count
 *  (an IN_PROGRESS session that started earlier today). */
const ACTIVE_LOOKBACK_MS = 12 * 60 * 60 * 1000;

export interface InboundPatient {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  languagePref: 'AR' | 'EN';
  createdAt: Date;
  updatedAt: Date;
}

export type InboundResolutionReason =
  | 'NONE'
  | 'SINGLE'
  | 'NEAREST_APPOINTMENT'
  | 'RECENT_APPOINTMENT'
  | 'RECENT_PROFILE';

export interface ResolvedInboundPatient {
  /** The chosen patient — null only when nobody active holds the phone. */
  patient: InboundPatient | null;
  /** Every active patient on the phone (the family), createdAt asc. */
  candidates: InboundPatient[];
  /** Which step of the rule decided — for logs and tests. */
  reason: InboundResolutionReason;
}

const byIdAsc = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function resolvePatientForInbound(
  phone: string,
  now: Date = new Date(),
): Promise<ResolvedInboundPatient> {
  const candidates = (
    await db.user.findMany({
      where: { phone, deletedAt: null, role: UserRole.PATIENT },
      select: {
        id: true,
        fullNameEn: true,
        fullNameAr: true,
        languagePref: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  )
    .map(
      (u): InboundPatient => ({
        ...u,
        languagePref: u.languagePref === 'AR' ? 'AR' : 'EN',
        // Defensive: test doubles / partial selects may omit the timestamps.
        createdAt: u.createdAt ?? new Date(0),
        updatedAt: u.updatedAt ?? new Date(0),
      }),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || byIdAsc(a, b));

  if (candidates.length === 0) return { patient: null, candidates, reason: 'NONE' };
  if (candidates.length === 1) return { patient: candidates[0]!, candidates, reason: 'SINGLE' };

  const ids = candidates.map((c) => c.id);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // ── Step 2: nearest active appointment ─────────────────────────────────
  const upcoming = await db.appointment.findMany({
    where: {
      patientId: { in: ids },
      status: { in: [...INBOUND_ACTIVE_STATUSES] },
      startsAt: { gte: new Date(now.getTime() - ACTIVE_LOOKBACK_MS) },
    },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, durationMinutes: true, patientId: true },
    take: 60,
  });
  const active = upcoming.filter(
    (a) =>
      a.patientId !== null &&
      byId.has(a.patientId) &&
      a.startsAt.getTime() + a.durationMinutes * 60_000 > now.getTime(),
  );
  if (active.length > 0) {
    const nearestStart = Math.min(...active.map((a) => a.startsAt.getTime()));
    const tied = active.filter((a) => a.startsAt.getTime() === nearestStart);
    let winner = tied[0]!;
    if (tied.length > 1) {
      const reminded = await db.whatsAppMessage.findMany({
        where: { direction: 'OUTBOUND', appointmentId: { in: tied.map((a) => a.id) } },
        select: { appointmentId: true },
      });
      const remindedIds = new Set(reminded.map((m) => m.appointmentId));
      const ranked = [...tied].sort((a, b) => {
        const ra = remindedIds.has(a.id) ? 0 : 1;
        const rb = remindedIds.has(b.id) ? 0 : 1;
        if (ra !== rb) return ra - rb;
        const pa = byId.get(a.patientId!)!;
        const pb = byId.get(b.patientId!)!;
        return pa.createdAt.getTime() - pb.createdAt.getTime() || byIdAsc(pa, pb);
      });
      winner = ranked[0]!;
    }
    return {
      patient: byId.get(winner.patientId!)!,
      candidates,
      reason: 'NEAREST_APPOINTMENT',
    };
  }

  // ── Step 3: most recently active ───────────────────────────────────────
  // Latest non-cancelled appointment per holder. `distinct` + desc order
  // gives one row per patient on Postgres; the JS max below keeps the result
  // correct regardless of how the rows come back.
  const history = await db.appointment.findMany({
    where: {
      patientId: { in: ids },
      status: {
        in: [...INBOUND_ACTIVE_STATUSES, AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW],
      },
    },
    orderBy: { startsAt: 'desc' },
    distinct: ['patientId'],
    select: { patientId: true, startsAt: true },
  });
  const latestByPatient = new Map<string, number>();
  for (const a of history) {
    if (!a.patientId || !byId.has(a.patientId)) continue;
    const t = a.startsAt.getTime();
    const prev = latestByPatient.get(a.patientId);
    if (prev === undefined || t > prev) latestByPatient.set(a.patientId, t);
  }

  const ranked = [...candidates].sort((a, b) => {
    const la = latestByPatient.get(a.id);
    const lb = latestByPatient.get(b.id);
    // Holders with any appointment rank above those with none.
    if ((la === undefined) !== (lb === undefined)) return la === undefined ? 1 : -1;
    if (la !== undefined && lb !== undefined && la !== lb) return lb - la;
    const ua = a.updatedAt.getTime();
    const ub = b.updatedAt.getTime();
    if (ua !== ub) return ub - ua;
    return byIdAsc(a, b);
  });
  const patient = ranked[0]!;
  return {
    patient,
    candidates,
    reason: latestByPatient.has(patient.id) ? 'RECENT_APPOINTMENT' : 'RECENT_PROFILE',
  };
}
