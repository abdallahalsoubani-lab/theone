'use client';

import { useSession } from 'next-auth/react';
import type { ReactNode } from 'react';

import { can, type PermissionResource } from '@/lib/rbac/can';

/**
 * Conditional render based on the current session and a permission code.
 *
 *   <Can action="audit_log.read">…admin-only panel…</Can>
 *   <Can action="treatment_plans.update.own" resource={{ ownerId: plan.doctorId }}>
 *     <Button>Edit plan</Button>
 *   </Can>
 *
 * Renders nothing (or the optional `fallback`) when:
 *   - the session is unauthenticated
 *   - the role does not include the permission
 *   - the scope check (`.own` / `.assigned`) fails against `resource`
 *
 * Server-rendered pages that need the same gate should use
 * `requirePermission()` from `lib/rbac/guards.ts` — never both at once.
 */
interface CanProps {
  action: string;
  resource?: PermissionResource;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Can({ action, resource, children, fallback = null }: CanProps) {
  const { data: session } = useSession();
  if (!session?.user) return <>{fallback}</>;
  if (!can(session.user, action, resource ?? {})) return <>{fallback}</>;
  return <>{children}</>;
}
