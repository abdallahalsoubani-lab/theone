import { AuditAction, UserRole } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';

import type { GrantCreateInput, GrantDeleteInput } from './schemas';

/**
 * P64 #4 — grant / revoke read-only access to a colleague's calendar.
 * Viewer = an active THERAPIST (doctors already read the whole clinic
 * calendar); owner = any active clinician (therapist or doctor).
 */
export class ScheduleGrantError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'ScheduleGrantError';
  }
}

export const GRANT_ERRORS = {
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    message_en: 'Please sign in again.',
    message_ar: 'يرجى تسجيل الدخول مجدداً.',
  },
  SELF: {
    code: 'GRANT_SELF',
    message_en: 'A therapist always sees their own schedule.',
    message_ar: 'المعالج يرى جدوله دائماً.',
  },
  BAD_VIEWER: {
    code: 'GRANT_BAD_VIEWER',
    message_en: 'The viewer must be an active therapist.',
    message_ar: 'يجب أن يكون صاحب الصلاحية معالجاً فعّالاً.',
  },
  BAD_OWNER: {
    code: 'GRANT_BAD_OWNER',
    message_en: 'The schedule owner must be an active therapist or doctor.',
    message_ar: 'يجب أن يكون صاحب الجدول معالجاً أو طبيباً فعّالاً.',
  },
  DUPLICATE: {
    code: 'GRANT_DUPLICATE',
    message_en: 'This access already exists.',
    message_ar: 'هذه الصلاحية موجودة مسبقاً.',
  },
  NOT_FOUND: {
    code: 'GRANT_NOT_FOUND',
    message_en: 'This access no longer exists.',
    message_ar: 'هذه الصلاحية لم تعد موجودة.',
  },
} satisfies Record<string, LocalizedError>;

type GrantResult = { id: string; viewerId: string; ownerId: string };

export const createScheduleGrant = withAudit<[GrantCreateInput], GrantResult>(
  {
    entityType: 'ScheduleViewGrant',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.id,
    extractAfter: (result) => ({
      event: 'SCHEDULE_GRANT_ADDED',
      viewerId: result.viewerId,
      ownerId: result.ownerId,
    }),
  },
  async function createScheduleGrantInner(input): Promise<GrantResult> {
    const session = await auth();
    if (!session?.user?.id) throw new ScheduleGrantError(GRANT_ERRORS.UNAUTHENTICATED);
    if (input.viewerId === input.ownerId) throw new ScheduleGrantError(GRANT_ERRORS.SELF);

    const [viewer, owner] = await Promise.all([
      db.user.findFirst({
        where: { id: input.viewerId, deletedAt: null, role: UserRole.THERAPIST },
        select: { id: true },
      }),
      db.user.findFirst({
        where: {
          id: input.ownerId,
          deletedAt: null,
          role: { in: [UserRole.THERAPIST, UserRole.DOCTOR] },
        },
        select: { id: true },
      }),
    ]);
    if (!viewer) throw new ScheduleGrantError(GRANT_ERRORS.BAD_VIEWER);
    if (!owner) throw new ScheduleGrantError(GRANT_ERRORS.BAD_OWNER);

    const existing = await db.scheduleViewGrant.findUnique({
      where: { viewerId_ownerId: { viewerId: input.viewerId, ownerId: input.ownerId } },
      select: { id: true },
    });
    if (existing) throw new ScheduleGrantError(GRANT_ERRORS.DUPLICATE);

    const row = await db.scheduleViewGrant.create({
      data: { viewerId: input.viewerId, ownerId: input.ownerId, createdById: session.user.id },
      select: { id: true },
    });
    return { id: row.id, viewerId: input.viewerId, ownerId: input.ownerId };
  },
);

export const deleteScheduleGrant = withAudit<[GrantDeleteInput], { id: string }>(
  {
    entityType: 'ScheduleViewGrant',
    action: AuditAction.DELETE,
    extractEntityId: (args) => args[0].grantId,
    extractBefore: async (args) =>
      db.scheduleViewGrant.findUnique({
        where: { id: args[0].grantId },
        select: { viewerId: true, ownerId: true },
      }),
  },
  async function deleteScheduleGrantInner(input): Promise<{ id: string }> {
    const row = await db.scheduleViewGrant.findUnique({
      where: { id: input.grantId },
      select: { id: true },
    });
    if (!row) throw new ScheduleGrantError(GRANT_ERRORS.NOT_FOUND);
    await db.scheduleViewGrant.delete({ where: { id: row.id } });
    return { id: row.id };
  },
);

export function grantToLocalized(err: unknown): LocalizedError {
  if (err instanceof ScheduleGrantError) return err.error;
  return toLocalizedError(err);
}
