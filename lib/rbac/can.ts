import type { UserRole } from '@prisma/client';

import { ROLE_PERMISSIONS, type PermissionCode } from './permissions';

/**
 * Minimal session-user shape consumed by `can()`. The full Session.user is a
 * superset; we keep the contract narrow so server code and tests can construct
 * a user without standing up Auth.js.
 */
export interface PermissionUser {
  id: string;
  role: UserRole;
}

/**
 * Per-resource context for scope checks.
 *   ownerId             — for `.own` permissions (e.g. patient.id)
 *   assignedClinicianIds — for `.assigned` permissions (the patient's primary
 *                          therapist / responsible doctor / any clinician on
 *                          the treatment plan)
 *   actorIdOverride      — rarely needed; lets callers test against an id
 *                          other than user.id (e.g. system-job actor)
 */
export interface PermissionResource {
  ownerId?: string;
  assignedClinicianIds?: ReadonlyArray<string>;
}

/**
 * Returns true iff the user has the given permission, including scope checks.
 *
 *   can(adminUser, 'users.create')                                → role grant
 *   can(patientUser, 'appointments.read.own', { ownerId })        → scope OK
 *   can(doctorUser, 'treatment_plans.update.own', { ownerId })    → owner check
 *   can(therapistUser, 'session_notes.read.assigned',
 *       { assignedClinicianIds: [...] })                          → assignment
 */
export function can(
  user: PermissionUser,
  action: string,
  resource: PermissionResource = {},
): boolean {
  // Admin universal-read bypass: any `*.read[.*]` action is permitted
  // regardless of the per-role grant set or scope. This covers the
  // observe / troubleshoot surface — Admin can render any clinical
  // page that any other role can — without giving Admin the ability
  // to *write* clinical data (mutations still require an explicit
  // grant). The regex deliberately matches the verb `.read` only
  // (not `.mark_read` or other read-adjacent verbs).
  if (user.role === 'ADMIN' && /^[a-z_]+\.read(\..+)?$/.test(action)) {
    return true;
  }

  const grants = ROLE_PERMISSIONS[user.role];
  if (!grants.has(action as PermissionCode)) return false;

  // Unscoped — the grant alone is sufficient.
  if (!action.includes('.')) return true;
  const scope = action.split('.').slice(2).join('.'); // 'own' | 'assigned' | 'limited' | ''

  if (!scope) return true;

  // List-intent fallback: when a scoped action (.own / .assigned / .limited)
  // is checked WITHOUT a concrete resource, treat it as a list-page entry
  // gate — the role grant alone is sufficient and the query layer is
  // responsible for narrowing to the user's owned / assigned rows.
  // This matches how list pages compose:
  //
  //   await requirePermission('patients.read.assigned');         // page gate
  //   const rows = await listPatients({ scope: { kind: 'assigned',
  //                                              clinicianId: user.id } });
  //
  // Single-resource intent always passes a `resource` (ownerId or
  // assignedClinicianIds) and goes through the strict checks below — so
  // existing callers that *do* pass a resource keep the same behaviour.
  const isResourceAbsent =
    resource.ownerId === undefined && resource.assignedClinicianIds === undefined;

  switch (scope) {
    case 'own':
      if (isResourceAbsent) return true;
      return Boolean(resource.ownerId) && resource.ownerId === user.id;
    case 'assigned':
      if (isResourceAbsent) return true;
      return Boolean(resource.assignedClinicianIds?.includes(user.id));
    case 'limited':
      // Limited-scope permissions are still owner-bound — the patient sees
      // their own timeline minus clinical detail.
      if (isResourceAbsent) return true;
      return Boolean(resource.ownerId) && resource.ownerId === user.id;
    // Multi-segment scope codes like 'read.patients' / 'read.therapists' are
    // role-broad (not actor-scoped) — the role-set membership above is enough.
    case 'patients':
    case 'therapists':
      return true;
    default:
      return false;
  }
}

/**
 * Convenience: build an `any-of` matcher for UI gates that want to render when
 * the user has any of a set of codes (e.g. "show the nav item if they can do
 * anything in this resource at all").
 */
export function canAny(
  user: PermissionUser,
  actions: ReadonlyArray<string>,
  resource: PermissionResource = {},
): boolean {
  return actions.some((a) => can(user, a, resource));
}
