import type { UserRole } from '@prisma/client';

/**
 * Where each role lands immediately after sign-in. Used by the middleware to
 * bounce authenticated users off `/login` and by the auth pages to compute
 * the redirect target on successful authentication.
 *
 * The placeholder pages for these routes exist from this prompt onwards —
 * feature prompts replace them in place rather than moving them.
 */
export const ROLE_HOME: Record<UserRole, string> = {
  ADMIN: '/admin/dashboard',
  SECRETARY: '/secretary/calendar',
  DOCTOR: '/doctor/dashboard',
  THERAPIST: '/therapist/dashboard',
  PATIENT: '/patient/dashboard',
};

/**
 * Paths reachable without authentication. The locale prefix is stripped
 * before matching so this list does not have to be repeated per locale.
 */
export const PUBLIC_PATHS: ReadonlyArray<string> = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/otp-verify',
  '/',
  '/style-guide',
  '/privacy',
  '/terms',
  '/contact',
  // Arrivals public surfaces (Prompt 18) — no staff session; gated instead by
  // a per-surface device token validated server-side inside the page itself.
  '/kiosk',
  '/display',
  // Public self-service intake (Prompt 23) — unauthenticated + write-only.
  // The page can only create a PENDING submission; it never reads patient
  // data or creates a patient. Abuse is bounded by IP rate-limit + honeypot.
  '/intake',
];

/**
 * If a user has `mustChangePassword: true`, every navigation except these
 * paths bounces to `/change-password`. The list includes `/change-password`
 * itself plus the sign-out route so a stuck account can still log out.
 */
export const PASSWORD_GATE_ALLOWLIST: ReadonlyArray<string> = [
  '/change-password',
  '/api/auth/signout',
];

/** Returns true when the bare path (locale-stripped) is publicly reachable. */
export function isPublicPath(barePath: string): boolean {
  if (PUBLIC_PATHS.includes(barePath)) return true;
  return PUBLIC_PATHS.some((p) => p !== '/' && barePath.startsWith(`${p}/`));
}

export function isPasswordGateAllowed(barePath: string): boolean {
  return PASSWORD_GATE_ALLOWLIST.includes(barePath);
}

/**
 * Each top-level role segment under `/[locale]/...` belongs to exactly
 * one role's UI surface. Paths under `/staff/...` are explicitly shared
 * across the three clinical roles; everything else (root, /notifications,
 * /style-guide, etc.) carries no role gate at this layer.
 *
 * Admin is allowed everywhere — the impersonation feature and ops
 * troubleshooting both depend on it. RBAC at the page/action boundary
 * (`requirePermission`) is still the authoritative gate; this map is the
 * pre-render redirect so a clinician clicking a stale link lands on
 * their own home instead of a ForbiddenError page.
 */
const ROLE_PATH_PREFIXES = {
  '/admin': new Set<UserRole>(['ADMIN']),
  '/secretary': new Set<UserRole>(['SECRETARY', 'ADMIN']),
  '/doctor': new Set<UserRole>(['DOCTOR', 'ADMIN']),
  '/therapist': new Set<UserRole>(['THERAPIST', 'ADMIN']),
  '/patient': new Set<UserRole>(['PATIENT', 'ADMIN']),
  '/staff': new Set<UserRole>(['SECRETARY', 'DOCTOR', 'THERAPIST', 'ADMIN']),
} as const;

/**
 * Returns the set of roles allowed under the given path's top-level
 * role prefix, or null when the path carries no role gate.
 */
export function getAllowedRolesForPath(barePath: string): ReadonlySet<UserRole> | null {
  for (const [prefix, allowed] of Object.entries(ROLE_PATH_PREFIXES)) {
    if (barePath === prefix || barePath.startsWith(`${prefix}/`)) {
      return allowed;
    }
  }
  return null;
}

/**
 * Convenience: true when the role may navigate to the path under the
 * role-prefix gate. Paths with no gate (root, notifications, …) always
 * return true.
 */
export function isPathAllowedForRole(barePath: string, role: UserRole): boolean {
  const allowed = getAllowedRolesForPath(barePath);
  return !allowed || allowed.has(role);
}
