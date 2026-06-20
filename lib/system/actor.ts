/**
 * The reserved "system" user — the audit actor for actions performed by
 * background workers that have no human session (Fix Prompt 2: the overdue
 * session auto-complete worker).
 *
 * `AuditLog.actorId` is a required FK to `User` (onDelete: Restrict) and
 * `withAudit` skips the row when the actor resolves to null, so a worker that
 * mutates state needs a real, stable User row to attribute the change to.
 * This user is seeded in `prisma/seed/reference-data.ts` with a fixed id and a
 * reserved, non-routable email; it has no password hash so it can never log in.
 * Auto-completions are therefore distinguishable from manual ends in the audit
 * log by `actorId = "system"` + the `SESSION_AUTO_COMPLETED` after-event tag.
 */
export const SYSTEM_USER_ID = 'system';

export const SYSTEM_USER = {
  id: SYSTEM_USER_ID,
  email: 'system@theone.internal',
  phone: 'system',
  fullNameEn: 'System',
  fullNameAr: 'النظام',
} as const;
