import 'server-only';

import type { UserRole } from '@prisma/client';

import { staffNavEntries, type StaffNavBadge } from '@/components/shell/staff-nav';
import { countUnconfirmedReminders } from '@/lib/appointments/confirmations';
import { countPendingApprovals } from '@/lib/clinical/home-program/approval';
import { countUnresolvedInbox } from '@/lib/inbox/queries';
import { countPendingSubmissions } from '@/lib/intake-submissions/queries';
import { countActiveWaitlist } from '@/lib/waitlist/queries';
import { countUnreadConversations } from '@/lib/whatsapp/inbox/queries';

/**
 * The sidebar's badge counts, in one place (PT-B4 item 3).
 *
 * These used to be computed inline in the (staff) layout, which is the reason
 * they went stale: the App Router reuses a shared layout across sibling
 * navigations, so the layout's server body — and these queries with it — does
 * not re-run when the secretary moves between tabs. The badge was frozen at
 * whatever the last full render saw, and only unfroze when a server action's
 * revalidatePath happened to re-render the whole tree.
 *
 * Extracting it lets the layout seed the first paint AND a polling action
 * refresh it afterwards from the identical computation, so the two can never
 * disagree.
 */
export type NavBadgeCounts = Record<StaffNavBadge, number>;

const EMPTY: NavBadgeCounts = {
  inbox: 0,
  waitlist: 0,
  intakeSubmissions: 0,
  homeProgramApprovals: 0,
  unconfirmed: 0,
  waInbox: 0,
};

/**
 * Counts for the badges this role's sidebar actually shows. Only the needed
 * queries run — a doctor's sidebar shouldn't pay for the secretary's inbox
 * and waitlist counts, and vice versa.
 */
export async function getNavBadgeCounts(role: UserRole, userId: string): Promise<NavBadgeCounts> {
  const needed = new Set(staffNavEntries(role).map((e) => e.badge));
  const [inbox, waitlist, intakeSubmissions, homeProgramApprovals, unconfirmed, waInbox] =
    await Promise.all([
      needed.has('inbox') ? countUnresolvedInbox() : Promise.resolve(0),
      needed.has('waitlist') ? countActiveWaitlist() : Promise.resolve(0),
      needed.has('intakeSubmissions') ? countPendingSubmissions() : Promise.resolve(0),
      needed.has('homeProgramApprovals')
        ? countPendingApprovals(role === 'ADMIN' ? null : userId)
        : Promise.resolve(0),
      needed.has('unconfirmed') ? countUnconfirmedReminders() : Promise.resolve(0),
      needed.has('waInbox') ? countUnreadConversations() : Promise.resolve(0),
    ]);
  return {
    ...EMPTY,
    inbox,
    waitlist,
    intakeSubmissions,
    homeProgramApprovals,
    unconfirmed,
    waInbox,
  };
}
