import 'server-only';

import type { WaDispatchReason, WaDispatchStatus, WaDispatchType } from '@prisma/client';

import { db } from '@/lib/db';

import { isUrgentDispatch } from './urgency';

/**
 * Admin outbox queries (P48). ADMIN-only surfaces — the page guard holds
 * `whatsapp_outbox.read`; phone is shown because ADMIN may see contact PII
 * anyway (P15).
 */

export interface OutboxRow {
  id: string;
  type: WaDispatchType;
  status: WaDispatchStatus;
  dispatchReason: WaDispatchReason | null;
  createdAt: Date;
  sentAt: Date | null;
  failureReason: string | null;
  appointmentId: string;
  appointmentStartsAt: Date | null;
  appointmentStatus: string | null;
  patientNameEn: string;
  patientNameAr: string;
  patientPhone: string | null;
  therapistsEn: string[];
  therapistsAr: string[];
  /** P50 — appointment starts within 24h. Visual only (see ./urgency.ts). */
  urgent: boolean;
}

const ROW_INCLUDE = {
  appointment: {
    select: {
      id: true,
      startsAt: true,
      status: true,
      therapists: {
        orderBy: { createdAt: 'asc' as const },
        include: { therapist: { select: { fullNameEn: true, fullNameAr: true } } },
      },
    },
  },
  patient: { select: { fullNameEn: true, fullNameAr: true, phone: true } },
};

type Raw = Awaited<ReturnType<typeof findRows>>[number];

function findRows(where: object) {
  return db.whatsAppDispatch.findMany({
    where,
    include: ROW_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

function toRow(r: Raw, now: Date): OutboxRow {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    dispatchReason: r.dispatchReason,
    createdAt: r.createdAt,
    sentAt: r.sentAt,
    failureReason: r.failureReason,
    appointmentId: r.appointmentId,
    appointmentStartsAt: r.appointment?.startsAt ?? null,
    appointmentStatus: r.appointment?.status ?? null,
    patientNameEn: r.patient?.fullNameEn ?? '',
    patientNameAr: r.patient?.fullNameAr ?? '',
    patientPhone: r.patient?.phone ?? null,
    therapistsEn: r.appointment?.therapists.map((t) => t.therapist.fullNameEn) ?? [],
    therapistsAr: r.appointment?.therapists.map((t) => t.therapist.fullNameAr) ?? [],
    urgent: isUrgentDispatch(r.appointment?.startsAt ?? null, now),
  };
}

export interface OutboxData {
  pending: Record<WaDispatchType, OutboxRow[]>;
  /** Everything that reached a terminal state in the last 24h — shown
   *  collapsed for confidence. */
  recent: OutboxRow[];
}

export async function getOutbox(): Promise<OutboxData> {
  const [pendingRows, recentRows] = await Promise.all([
    findRows({ status: 'PENDING' }),
    findRows({
      status: { in: ['SENT', 'FAILED', 'SUPERSEDED', 'EXCLUDED', 'SCHEDULED'] },
      updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);
  const pending: OutboxData['pending'] = {
    BOOKING_CONFIRMATION: [],
    RESCHEDULE: [],
    CANCELLATION: [],
  };
  const now = new Date();
  for (const r of pendingRows) pending[r.type].push(toRow(r, now));
  // Urgent entries float to the top of their section so the admin sees
  // what to send first; within each group the newest stays first.
  for (const type of Object.keys(pending) as WaDispatchType[]) {
    pending[type].sort((a, b) => Number(b.urgent) - Number(a.urgent));
  }
  return { pending, recent: recentRows.map((r) => toRow(r, now)) };
}

/** Total PENDING across the three types — the admin sidebar badge. */
export async function pendingOutboxCount(): Promise<number> {
  return db.whatsAppDispatch.count({ where: { status: 'PENDING' } });
}
