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
