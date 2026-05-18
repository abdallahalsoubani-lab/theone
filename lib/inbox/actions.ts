'use server';

import { revalidatePath } from 'next/cache';

import { auth } from '@/auth';
import { db } from '@/lib/db';
import { AuditAction } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { withAudit } from '@/lib/audit/withAudit';
import { requirePermission } from '@/lib/rbac/guards';

interface ResolveInboxItemArgs {
  id: string;
}

/**
 * Mark an inbox item resolved. The Secretary uses this after taking the
 * action manually (calling the patient back, opening the calendar to
 * reschedule, etc.). Auto-resolution doesn't exist in v1 — every item is
 * an action item that needs a human to close.
 *
 * Audited: actor = the Secretary, entity = InboxItem, after.event = RESOLVED.
 */
const resolveInner = withAudit<[ResolveInboxItemArgs], { id: string }>(
  {
    entityType: 'InboxItem',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: () => ({ event: 'RESOLVED' }) as Prisma.InputJsonValue,
  },
  async function inner({ id }): Promise<{ id: string }> {
    const session = await auth();
    if (!session?.user) throw new Error('unauthenticated');
    await db.inboxItem.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedById: session.user.id },
    });
    return { id };
  },
);

export async function resolveInboxItemAction(
  args: ResolveInboxItemArgs,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePermission('inbox.resolve');
  try {
    await resolveInner(args);
    revalidatePath('/secretary/inbox');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
