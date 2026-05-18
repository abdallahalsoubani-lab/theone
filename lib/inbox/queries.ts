import 'server-only';

import type { InboxItemType } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * Inbox queries — read paths for the Secretary inbox UI (Prompt 8 §4.8).
 *
 * The page lists *unresolved* items (resolvedAt IS NULL) ordered by recency.
 * Resolved items stay in the table for audit; a future enhancement could add
 * a tab to browse them.
 */

export interface InboxListRow {
  id: string;
  type: InboxItemType;
  createdAt: Date;
  note: string | null;
  appointmentId: string | null;
  messageId: string | null;
  patient: { id: string; fullNameEn: string; fullNameAr: string; phone: string } | null;
  appointment: { id: string; startsAt: Date; status: string } | null;
  message: { id: string; body: string; direction: string; sentAt: Date } | null;
}

export async function listUnresolvedInbox(): Promise<InboxListRow[]> {
  return db.inboxItem.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      createdAt: true,
      note: true,
      appointmentId: true,
      messageId: true,
      patient: { select: { id: true, fullNameEn: true, fullNameAr: true, phone: true } },
      appointment: { select: { id: true, startsAt: true, status: true } },
      message: { select: { id: true, body: true, direction: true, sentAt: true } },
    },
  });
}

export async function countUnresolvedInbox(): Promise<number> {
  return db.inboxItem.count({ where: { resolvedAt: null } });
}
