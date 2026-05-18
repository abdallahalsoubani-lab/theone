import { AuditAction, LeaveStatus, UserRole } from '@prisma/client';

import { auth } from '@/auth';
import { withAudit } from '@/lib/audit/withAudit';
import { db, toLocalizedError, type LocalizedError } from '@/lib/db';
import { createNotification } from '@/lib/notifications/actions';

import { scanLeaveConflicts } from './conflictScan';
import type { LeaveApproveInput, LeaveRejectInput, LeaveRequestParsed } from './schemas';

export class LeaveError extends Error {
  constructor(public readonly error: LocalizedError) {
    super(error.message_en);
    this.name = 'LeaveError';
  }
}

const unauthenticated: LocalizedError = {
  code: 'UNAUTHENTICATED',
  message_en: 'Sign-in required.',
  message_ar: 'يلزم تسجيل الدخول.',
};

const notFound: LocalizedError = {
  code: 'LEAVE_NOT_FOUND',
  message_en: 'Leave request not found.',
  message_ar: 'طلب الإجازة غير موجود.',
};

const notPending: LocalizedError = {
  code: 'LEAVE_NOT_PENDING',
  message_en: 'Only pending leaves can be approved or rejected.',
  message_ar: 'يمكن الموافقة أو الرفض فقط للطلبات المعلقة.',
};

export const requestLeave = withAudit<
  [LeaveRequestParsed],
  { leaveId: string; adminCount: number }
>(
  {
    entityType: 'Leave',
    action: AuditAction.CREATE,
    extractEntityId: (_args, result) => result.leaveId,
    extractAfter: (result) => ({
      event: 'LEAVE_REQUESTED',
      leaveId: result.leaveId,
    }),
  },
  async function requestInner(input): Promise<{ leaveId: string; adminCount: number }> {
    const session = await auth();
    if (!session?.user?.id) throw new LeaveError(unauthenticated);

    const created = await db.leave.create({
      data: {
        userId: session.user.id,
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
        status: LeaveStatus.PENDING,
      },
      select: { id: true },
    });

    // Fan out one in-app notification per Admin so any Admin online
    // can act. Best-effort: failures log + continue so the request
    // still persists even if a recipient row can't be written.
    const admins = await db.user.findMany({
      where: { role: UserRole.ADMIN, deletedAt: null },
      select: { id: true, fullNameEn: true },
    });
    const requesterName = session.user.name ?? session.user.email ?? 'staff member';
    for (const a of admins) {
      void createNotification({
        recipientId: a.id,
        type: 'LEAVE_REQUESTED',
        params: {
          requesterName,
          dateRange: `${input.startDate.toISOString().slice(0, 10)} – ${input.endDate
            .toISOString()
            .slice(0, 10)}`,
        },
        linkPath: '/admin/leaves',
        relatedEntityType: 'Leave',
        relatedEntityId: created.id,
      }).catch((err: unknown) => {
        console.error('[leave.request] admin notification failed', err);
      });
    }

    return { leaveId: created.id, adminCount: admins.length };
  },
);

export const approveLeave = withAudit<
  [LeaveApproveInput],
  {
    leaveId: string;
    requesterId: string;
    conflictCount: number;
  }
>(
  {
    entityType: 'Leave',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (result) => ({
      event: 'LEAVE_APPROVED',
      conflictCount: result.conflictCount,
    }),
  },
  async function approveInner(input): Promise<{
    leaveId: string;
    requesterId: string;
    conflictCount: number;
  }> {
    const session = await auth();
    if (!session?.user?.id) throw new LeaveError(unauthenticated);

    const existing = await db.leave.findUnique({
      where: { id: input.id },
      select: { id: true, userId: true, status: true, startDate: true, endDate: true },
    });
    if (!existing) throw new LeaveError(notFound);
    if (existing.status !== LeaveStatus.PENDING) throw new LeaveError(notPending);

    await db.leave.update({
      where: { id: input.id },
      data: {
        status: LeaveStatus.APPROVED,
        approvedById: session.user.id,
      },
    });

    // Conflict scan (§4.1.4) — surface clashes to the Secretary's
    // inbox so a human resolves each one (reassign therapist or
    // cancel). The conflict engine already prevents new bookings
    // during the window; this catches the retrospective case.
    const conflicts = await scanLeaveConflicts({
      userId: existing.userId,
      startDate: existing.startDate,
      endDate: existing.endDate,
    });
    if (conflicts.length > 0) {
      await db.inboxItem.createMany({
        data: conflicts.map((c) => ({
          type: 'LEAVE_CONFLICT' as const,
          patientId: c.patientId,
          appointmentId: c.appointmentId,
          leaveId: input.id,
          note: `Therapist on leave ${existing.startDate
            .toISOString()
            .slice(0, 10)} – ${existing.endDate.toISOString().slice(0, 10)}`,
        })),
      });
    }

    void createNotification({
      recipientId: existing.userId,
      type: 'LEAVE_APPROVED',
      params: {
        dateRange: `${existing.startDate.toISOString().slice(0, 10)} – ${existing.endDate
          .toISOString()
          .slice(0, 10)}`,
      },
      linkPath: '/staff/leave',
      relatedEntityType: 'Leave',
      relatedEntityId: input.id,
    }).catch((err: unknown) => {
      console.error('[leave.approve] requester notification failed', err);
    });

    return {
      leaveId: input.id,
      requesterId: existing.userId,
      conflictCount: conflicts.length,
    };
  },
);

export const rejectLeave = withAudit<
  [LeaveRejectInput],
  { leaveId: string; requesterId: string; reason: string }
>(
  {
    entityType: 'Leave',
    action: AuditAction.UPDATE,
    extractEntityId: (args) => args[0].id,
    extractAfter: (result) => ({
      event: 'LEAVE_REJECTED',
      reason: result.reason,
    }),
  },
  async function rejectInner(
    input,
  ): Promise<{ leaveId: string; requesterId: string; reason: string }> {
    const session = await auth();
    if (!session?.user?.id) throw new LeaveError(unauthenticated);

    const existing = await db.leave.findUnique({
      where: { id: input.id },
      select: { id: true, userId: true, status: true, startDate: true, endDate: true },
    });
    if (!existing) throw new LeaveError(notFound);
    if (existing.status !== LeaveStatus.PENDING) throw new LeaveError(notPending);

    await db.leave.update({
      where: { id: input.id },
      data: { status: LeaveStatus.REJECTED, approvedById: session.user.id },
    });

    void createNotification({
      recipientId: existing.userId,
      type: 'LEAVE_REJECTED',
      params: {
        reason: input.reason,
        dateRange: `${existing.startDate.toISOString().slice(0, 10)} – ${existing.endDate
          .toISOString()
          .slice(0, 10)}`,
      },
      linkPath: '/staff/leave',
      relatedEntityType: 'Leave',
      relatedEntityId: input.id,
    }).catch((err: unknown) => {
      console.error('[leave.reject] requester notification failed', err);
    });

    return { leaveId: input.id, requesterId: existing.userId, reason: input.reason };
  },
);

export function leaveToLocalized(err: unknown): LocalizedError {
  if (err instanceof LeaveError) return err.error;
  return toLocalizedError(err);
}
