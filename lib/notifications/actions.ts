'use server';

import { AuditAction } from '@prisma/client';
import type { NotificationType, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac/guards';

import { NOTIFICATION_TEMPLATES, type NotificationParams } from './templates';

export interface CreateNotificationArgs<T extends NotificationType = NotificationType> {
  recipientId: string;
  type: T;
  params: T extends keyof NotificationParams ? NotificationParams[T] : Record<string, string>;
  linkPath?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

/**
 * Internal notification creator — called by clinical actions (not a
 * client-facing server action). The caller passes a recipient + type +
 * params shape; we look up the i18n keys from the template map and
 * insert. Non-blocking: the caller does NOT await the audit log.
 *
 * No requirePermission gate here because the caller is server-internal
 * (action code that already passed its own permission check). Audited
 * with the originating session user as the actor.
 */
export async function createNotification<T extends NotificationType>(
  args: CreateNotificationArgs<T>,
): Promise<{ id: string }> {
  const template = NOTIFICATION_TEMPLATES[args.type];
  const session = await auth();
  const actorId = session?.user?.id ?? args.recipientId;

  const row = await db.notification.create({
    data: {
      recipientId: args.recipientId,
      type: args.type,
      titleKey: template.titleKey,
      bodyKey: template.bodyKey,
      params: args.params as Prisma.InputJsonValue,
      linkPath: args.linkPath ?? null,
      relatedEntityType: args.relatedEntityType ?? null,
      relatedEntityId: args.relatedEntityId ?? null,
    },
    select: { id: true },
  });

  // Fire-and-forget audit. If the audit insert fails the notification
  // still exists; we never want a logging hiccup to block clinical flow.
  void db.auditLog
    .create({
      data: {
        actorId,
        entityType: 'Notification',
        entityId: row.id,
        action: AuditAction.CREATE,
        after: {
          recipientId: args.recipientId,
          type: args.type,
          relatedEntityType: args.relatedEntityType,
          relatedEntityId: args.relatedEntityId,
        } as Prisma.InputJsonValue,
      },
    })
    .catch((err: unknown) => {
      console.error('[notifications] audit create failed', err);
    });

  return row;
}

/**
 * Mark one notification read. Owners only — other users cannot mark
 * someone else's notification.
 */
const markReadInner = withAudit<[{ id: string }], { id: string }>(
  {
    entityType: 'Notification',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'MARKED_READ' }) as Prisma.InputJsonValue,
  },
  async function inner({ id }): Promise<{ id: string }> {
    const session = await auth();
    if (!session?.user) throw new Error('unauthenticated');
    // Update with a WHERE clause that includes the recipientId — if it
    // doesn't match, no rows are touched and we return the id without
    // erroring (idempotent for the caller).
    await db.notification.updateMany({
      where: { id, recipientId: session.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { id };
  },
);

export async function markNotificationReadAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePermission('notifications.mark_read.own', {});
  try {
    await markReadInner({ id });
    revalidatePath('/notifications');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function markAllNotificationsReadAction(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  await requirePermission('notifications.mark_read.own', {});
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'unauthenticated' };
  try {
    const res = await db.notification.updateMany({
      where: { recipientId: session.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath('/notifications');
    return { ok: true, count: res.count };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Server action exposed to the NotificationBell client component to
 * fetch the unread count on its 60-second poll. Tiny wrapper so the
 * client doesn't talk directly to db/auth.
 */
export async function getUnreadNotificationCountAction(): Promise<number> {
  const session = await auth();
  if (!session?.user) return 0;
  return db.notification.count({
    where: { recipientId: session.user.id, readAt: null },
  });
}
