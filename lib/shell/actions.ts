'use server';

import { getEffectiveSession } from '@/lib/impersonation/session';

import { getNavBadgeCounts, type NavBadgeCounts } from './nav-badges';

/**
 * Refresh the sidebar badge counts (PT-B4 item 3).
 *
 * Mirrors getUnreadNotificationCountAction: a plain read the client polls, so
 * a new intake request reaches the secretary's sidebar without her navigating
 * or reloading. No new transport — the App Router simply never re-runs a
 * shared layout on sibling navigation, which is why the counts went stale.
 *
 * Impersonation-aware (getEffectiveSession) so Act-As shows the impersonated
 * user's counters, matching the first paint from the layout.
 */
export async function getNavBadgeCountsAction(): Promise<NavBadgeCounts | null> {
  const session = await getEffectiveSession();
  if (!session?.user || session.user.role === 'PATIENT') return null;
  return getNavBadgeCounts(session.user.role, session.user.id);
}
