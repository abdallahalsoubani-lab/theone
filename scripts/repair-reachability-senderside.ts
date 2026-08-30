/**
 * P59 — un-flag patients wrongly marked WhatsApp-unreachable by SENDER-SIDE
 * failures.
 *
 *   pnpm tsx scripts/repair-reachability-senderside.ts            # dry-run
 *   pnpm tsx scripts/repair-reachability-senderside.ts --apply    # write + audit
 *
 * Background: until P59, every FAILED delivery flipped
 * `User.whatsappReachable=false` — including Twilio 63018 (OUR sender's
 * per-day messaging limit, hit on broadcast mornings) and 63049 (Meta's
 * marketing-template throttle). Those say nothing about the recipient, yet
 * the flag makes every later automatic send skip the patient silently.
 *
 * This scan resets the flag for non-deleted users whose LAST recorded
 * failure is classified sender-side by `isSenderSideFailure` (the same
 * classifier the workers now use). The failure timestamp/reason are kept
 * as history; only the flag flips. A patient whose last failure is a real
 * recipient error (63024 invalid recipient, opt-out, …) is untouched.
 *
 * Console prints user ids and reasons only — never phones or names.
 */

import { AuditAction } from '@prisma/client';

import { db } from '@/lib/db';
import { isSenderSideFailure } from '@/lib/whatsapp/errors';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

export interface ReachabilityRepairResult {
  flagged: number;
  reset: Array<{ id: string; reason: string }>;
  kept: number;
  applied: boolean;
}

export async function runReachabilityRepair(opts: {
  apply: boolean;
}): Promise<ReachabilityRepairResult> {
  const users = await db.user.findMany({
    where: { deletedAt: null, whatsappReachable: false },
    select: { id: true, whatsappLastFailureReason: true },
    orderBy: { createdAt: 'asc' },
  });

  const result: ReachabilityRepairResult = {
    flagged: users.length,
    reset: [],
    kept: 0,
    applied: opts.apply,
  };

  for (const u of users) {
    const reason = u.whatsappLastFailureReason;
    if (!isSenderSideFailure(reason)) {
      result.kept += 1;
      continue;
    }
    result.reset.push({ id: u.id, reason: reason ?? '' });
    if (opts.apply) {
      await db.user.update({
        where: { id: u.id },
        data: { whatsappReachable: true },
      });
      await db.auditLog.create({
        data: {
          actorId: SYSTEM_USER_ID,
          entityType: 'User',
          entityId: u.id,
          action: AuditAction.UPDATE,
          after: { event: 'WHATSAPP_REACHABILITY_RESET_SENDER_SIDE', reason },
        },
      });
    }
  }

  console.log(`[reachability-repair] mode=${opts.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  flagged unreachable:  ${result.flagged}`);
  console.log(`  ${opts.apply ? 'reset' : 'would reset'} (sender-side): ${result.reset.length}`);
  for (const r of result.reset) console.log(`    - ${r.id}: ${r.reason}`);
  console.log(`  kept (recipient-side): ${result.kept}`);
  return result;
}

// ─── CLI ───────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('repair-reachability-senderside.ts')) {
  runReachabilityRepair({ apply: process.argv.includes('--apply') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[reachability-repair] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    })
    .finally(() => (db as unknown as { $disconnect(): Promise<void> }).$disconnect());
}
