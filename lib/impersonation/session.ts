import 'server-only';

import type { LanguagePref, UserRole } from '@prisma/client';

import { auth } from '@/auth';
import { db } from '@/lib/db';

import { readImpersonationCookie } from './cookie';

/**
 * A single user shape both the real-session path and the impersonation path
 * return. Matches the Auth.js v5 `Session['user']` augmentation in
 * `lib/auth/types.ts`, so callers can pass it to `can()` and existing
 * permission helpers without adapters.
 */
export interface EffectiveUser {
  id: string;
  role: UserRole;
  languagePref: LanguagePref;
  fullNameEn: string;
  fullNameAr: string;
  mustChangePassword: boolean;
  email?: string | null;
  name?: string | null;
}

export type EffectiveSession =
  | {
      user: EffectiveUser;
      isImpersonating: false;
      adminId: null;
      realAdmin: null;
    }
  | {
      user: EffectiveUser;
      isImpersonating: true;
      /** The real Admin who initiated the session (= actor for audit). */
      adminId: string;
      /** Full admin user record — useful for the banner + the audit wrapper. */
      realAdmin: EffectiveUser;
    }
  | null;

/**
 * The canonical session resolver for any code path where impersonation must
 * affect the outcome — RBAC guards, the audit decorator, the impersonation
 * banner, role-aware page wrappers.
 *
 * Resolution order:
 *   1. No Auth.js session → return null. Impersonation requires a real
 *      Admin session to even read the cookie.
 *   2. Auth.js session exists, no impersonation cookie OR cookie invalid →
 *      return `{ user: real, isImpersonating: false }`.
 *   3. Auth.js session exists AND cookie valid AND the real user IS Admin →
 *      load the target user from DB and return it as `user`, with the
 *      Admin captured separately.
 *   4. Auth.js session exists AND cookie valid BUT the real user is NOT
 *      Admin → return real session without impersonation. Middleware is
 *      responsible for clearing the tampered cookie.
 *
 * The DB lookup for the target user is unconditional whenever impersonation
 * is active so that a role change or a soft-delete of the target mid-session
 * is reflected immediately.
 */
export async function getEffectiveSession(): Promise<EffectiveSession> {
  // `auth()` reads cookies and throws outside a request scope. Background
  // workers and direct service tests invoke audited code with no scope, so
  // collapse the throw to "no session" rather than crashing the caller.
  // The variable is intentionally untyped — Auth.js v5 overloads `auth` as
  // both a session-reader and a middleware wrapper, and a `let` typed via
  // `Awaited<ReturnType<typeof auth>>` picks the wrong overload.
  const session = await auth().catch(() => null);
  if (!session?.user) return null;

  const realUser: EffectiveUser = {
    id: session.user.id,
    role: session.user.role,
    languagePref: session.user.languagePref,
    fullNameEn: session.user.fullNameEn,
    fullNameAr: session.user.fullNameAr,
    mustChangePassword: session.user.mustChangePassword,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
  };

  const cookie = await readImpersonationCookie();
  if (!cookie) {
    return { user: realUser, isImpersonating: false, adminId: null, realAdmin: null };
  }

  // Hard rule: only Admins can impersonate. A non-Admin session with a
  // valid-looking cookie is treated as not-impersonating; middleware will
  // clear the cookie on the next request so the state doesn't linger.
  if (realUser.role !== 'ADMIN' || cookie.adminId !== realUser.id) {
    return { user: realUser, isImpersonating: false, adminId: null, realAdmin: null };
  }

  const target = await db.user.findUnique({
    where: { id: cookie.targetUserId, deletedAt: null },
    select: {
      id: true,
      role: true,
      languagePref: true,
      fullNameEn: true,
      fullNameAr: true,
      mustChangePassword: true,
      email: true,
    },
  });

  // Target was deleted (or never existed) — fall back to the real Admin
  // session. The endpoint that calls `endImpersonation()` will clear the
  // stale cookie on the next mutation.
  if (!target) {
    return { user: realUser, isImpersonating: false, adminId: null, realAdmin: null };
  }

  return {
    user: {
      id: target.id,
      role: target.role,
      languagePref: target.languagePref,
      fullNameEn: target.fullNameEn,
      fullNameAr: target.fullNameAr,
      mustChangePassword: target.mustChangePassword,
      email: target.email,
      name: null,
    },
    isImpersonating: true,
    adminId: realUser.id,
    realAdmin: realUser,
  };
}
