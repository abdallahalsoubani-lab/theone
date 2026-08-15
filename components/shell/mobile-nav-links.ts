/**
 * Pick which link set the mobile drawer shows (Prompt 46 item C).
 *
 * The Header sits ABOVE the route groups, so unlike the desktop sidebars
 * (each mounted by its own layout) the drawer receives every set the
 * viewer's role can use and picks by the current path: an Admin browsing
 * /admin/* gets the admin entries, and the same Admin browsing a staff
 * surface (/secretary/*, …) gets the staff entries — mirroring which
 * desktop sidebar would be visible there.
 *
 * Pure module (no next-intl / React imports) so it stays unit-testable.
 */
export function pickMobileLinks<T>(
  pathname: string,
  staffLinks: ReadonlyArray<T>,
  adminLinks: ReadonlyArray<T>,
): ReadonlyArray<T> {
  if (adminLinks.length > 0 && (pathname === '/admin' || pathname.startsWith('/admin/'))) {
    return adminLinks;
  }
  if (staffLinks.length > 0) return staffLinks;
  return adminLinks;
}
