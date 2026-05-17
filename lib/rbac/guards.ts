import { auth } from '@/auth';
import { AUTH_ERRORS } from '@/lib/auth/result';
import type { LocalizedError } from '@/lib/db';

import { can, type PermissionResource } from './can';

/**
 * Thrown by `requirePermission` when the actor is missing or denied. Carries
 * the localized error shape so the outer server-action / route boundary can
 * forward it to the client without re-translating.
 */
export class ForbiddenError extends Error {
  constructor(public readonly error: LocalizedError = AUTH_ERRORS.FORBIDDEN) {
    super(error.message_en);
    this.name = 'ForbiddenError';
  }
}

/**
 * Server-side guard. Looks up the current session and throws ForbiddenError
 * if the user is unauthenticated or denied. Returns the session.user on success
 * so callers can chain it without a second `auth()` call.
 *
 *   const user = await requirePermission('appointments.create');
 *   const user = await requirePermission('treatment_plans.update.own',
 *                                        { ownerId: plan.doctorId });
 */
export async function requirePermission(action: string, resource: PermissionResource = {}) {
  const session = await auth();
  if (!session?.user) throw new ForbiddenError(AUTH_ERRORS.UNAUTHENTICATED);
  if (!can(session.user, action, resource)) throw new ForbiddenError();
  return session.user;
}
