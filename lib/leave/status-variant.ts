import { LeaveStatus } from '@prisma/client';

/** Shared badge variant for a leave status — one place instead of three. */
export function leaveStatusVariant(s: LeaveStatus): 'cyan' | 'muted' | 'destructive' {
  switch (s) {
    case LeaveStatus.APPROVED:
      return 'cyan';
    case LeaveStatus.REJECTED:
      return 'destructive';
    default:
      return 'muted';
  }
}
