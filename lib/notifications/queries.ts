import 'server-only';

import type { NotificationType, Prisma } from '@prisma/client';

import { auth } from '@/auth';
import { db } from '@/lib/db';

export interface NotificationListRow {
  id: string;
  type: NotificationType;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string>;
  linkPath: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Fetch the current user's notifications, newest first. Default 20
 * rows for the bell dropdown; the dedicated /notifications page passes
 * larger `take` values for pagination.
 */
export async function listNotificationsForCurrentUser(
  take = 20,
  skip = 0,
): Promise<NotificationListRow[]> {
  const session = await auth();
  if (!session?.user) return [];
  const rows = await db.notification.findMany({
    where: { recipientId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
    select: {
      id: true,
      type: true,
      titleKey: true,
      bodyKey: true,
      params: true,
      linkPath: true,
      readAt: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    params: serializeParams(r.params),
  }));
}

export async function countUnreadNotificationsForCurrentUser(): Promise<number> {
  const session = await auth();
  if (!session?.user) return 0;
  return db.notification.count({
    where: { recipientId: session.user.id, readAt: null },
  });
}

/**
 * Total count for the /notifications page paginator.
 */
export async function countNotificationsForCurrentUser(): Promise<number> {
  const session = await auth();
  if (!session?.user) return 0;
  return db.notification.count({ where: { recipientId: session.user.id } });
}

function serializeParams(input: Prisma.JsonValue): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = v == null ? '' : String(v);
  }
  return out;
}
