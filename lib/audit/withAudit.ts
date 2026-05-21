import type { AuditAction } from '@prisma/client';

import { db } from '@/lib/db';
import { getEffectiveSession } from '@/lib/impersonation/session';

/**
 * Audit decorator (Prompt 4 §4.10).
 *
 * Wraps a state-changing service function so every successful call writes an
 * `AuditLog` row carrying the actor, entity, action, and optional before/after
 * snapshots. The wrapped function's signature and return value are preserved
 * exactly — the decorator is fully transparent to callers.
 *
 *   const updatePatient = withAudit({
 *     entityType: 'PatientProfile',
 *     action: AuditAction.UPDATE,
 *     extractEntityId: (args, _result) => args[0].id,
 *     extractBefore: async (args) => db.patientProfile.findUnique({ where: { id: args[0].id } }),
 *     extractAfter: (result) => result,
 *   }, async function updatePatientInner({ id, patch }) { ... });
 *
 * Discipline:
 *   - Every service function that mutates state MUST be wrapped at its export.
 *     CI cannot enforce this — code review and the audit/README.md checklist
 *     do. Forgetting it is a security-review blocker.
 *   - The wrapper is NO-OP if the function throws: we only audit committed
 *     state changes.
 *   - Reading sensitive fields (`AuditAction.READ_SENSITIVE`) is also audited
 *     by wrapping the relevant query in withAudit with that action enum.
 */
export interface AuditConfig<TArgs extends unknown[], TResult> {
  entityType: string;
  action: AuditAction;
  /** Derive the entity id from the args and/or the result of the inner call. */
  extractEntityId: (args: TArgs, result: TResult) => string;
  /** Optional pre-call snapshot — useful for UPDATE / DELETE diffs. */
  extractBefore?: (args: TArgs) => Promise<unknown>;
  /** Optional post-call snapshot. Pass redacted views — never raw secrets. */
  extractAfter?: (result: TResult) => unknown;
  /**
   * Optional explicit actor override. Defaults to the authenticated session.
   * Useful for system jobs (cron WhatsApp reminders) that have no user session
   * — pass a stable system-user id in that case.
   */
  actorOverride?: () => Promise<string | null>;
}

export function withAudit<TArgs extends unknown[], TResult>(
  config: AuditConfig<TArgs, TResult>,
  fn: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    const before = config.extractBefore ? await config.extractBefore(args) : undefined;
    const result = await fn(...args);

    // During an Admin impersonation session the *Admin* is the responsible
    // actor for every mutation — the impersonated user is captured
    // alongside as `impersonatedUserId` so the audit row preserves the
    // full "who actually did this" picture.
    const effective = config.actorOverride ? null : await getEffectiveSession();
    const actorId = config.actorOverride
      ? await config.actorOverride()
      : effective?.isImpersonating
        ? effective.adminId
        : (effective?.user?.id ?? null);
    const impersonatedUserId = effective?.isImpersonating ? effective.user.id : null;

    if (actorId) {
      const entityId = config.extractEntityId(args, result);
      const after = config.extractAfter ? config.extractAfter(result) : undefined;
      try {
        await db.auditLog.create({
          data: {
            actorId,
            impersonatedUserId,
            entityType: config.entityType,
            entityId,
            action: config.action,
            before: before === undefined ? undefined : (before as object),
            after: after === undefined ? undefined : (after as object),
          },
        });
      } catch (err) {
        // Audit write failures must never break the user-visible operation.
        // Surface to the server log instead so the monitoring layer (Sentry
        // in Prompt 11) picks them up.
        console.error('[audit] failed to write audit row', {
          entityType: config.entityType,
          action: config.action,
          err,
        });
      }
    }

    return result;
  };
}
