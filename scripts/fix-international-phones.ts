/**
 * P58 item 3 — normalise malformed stored phone numbers.
 *
 *   pnpm tsx scripts/fix-international-phones.ts            # dry-run (default)
 *   pnpm tsx scripts/fix-international-phones.ts --apply    # write + audit
 *
 * Scans every non-deleted User whose `phone` is not canonical E.164
 * (`+<digits>`, 8–15 digits) — the shape every write path enforces since
 * P52/P58 — and:
 *   - RECOVERABLE: the raw value normalises via the same chain the entry
 *     points now use (`normalizePhoneForStorage` — Jordanian shapes, then
 *     separator-stripped international E.164) → proposed old→new; --apply
 *     writes it with one audit row per fix (actor = system).
 *   - UNRECOVERABLE: listed (masked) for manual correction by the secretary;
 *     never guessed, never nulled — a wrong normalisation could message a
 *     stranger (P50 owner ruling #5).
 *
 * Known population at write time: exactly one row (`+972 52-505-4631`,
 * stored raw by the pre-P58 quick-add fallback). The scan is generic so any
 * future stray is caught by re-running.
 *
 * Console prints phones MASKED to the last 3 digits; the full values live
 * only in the DB and the audit rows.
 */

import { AuditAction } from '@prisma/client';

import { db } from '@/lib/db';
import { normalizePhoneForStorage } from '@/lib/format/phone';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

const CANONICAL_E164 = /^\+[1-9]\d{7,14}$/;

function mask(phone: string): string {
  if (phone.length <= 3) return phone;
  return '*'.repeat(phone.length - 3) + phone.slice(-3);
}

export interface PhoneFixDb {
  user: {
    findMany(args: {
      where: { deletedAt: null; phone: { not: null } };
      select: { id: boolean; phone: boolean; fullNameEn: boolean; role: boolean };
      orderBy: { createdAt: 'asc' };
    }): Promise<Array<{ id: string; phone: string | null; fullNameEn: string; role: string }>>;
    update(args: { where: { id: string }; data: { phone: string } }): Promise<unknown>;
  };
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface PhoneFixResult {
  scanned: number;
  malformed: number;
  fixed: Array<{ id: string; role: string; from: string; to: string }>;
  unrecoverable: Array<{ id: string; role: string; name: string; raw: string }>;
  applied: boolean;
}

export async function runPhoneFix(
  deps: { db: PhoneFixDb; log?: (msg: string) => void },
  opts: { apply: boolean },
): Promise<PhoneFixResult> {
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const users = await deps.db.user.findMany({
    where: { deletedAt: null, phone: { not: null } },
    select: { id: true, phone: true, fullNameEn: true, role: true },
    orderBy: { createdAt: 'asc' },
  });

  const result: PhoneFixResult = {
    scanned: users.length,
    malformed: 0,
    fixed: [],
    unrecoverable: [],
    applied: opts.apply,
  };

  for (const u of users) {
    const phone = u.phone;
    if (!phone || CANONICAL_E164.test(phone)) continue;
    result.malformed += 1;

    const normalized = normalizePhoneForStorage(phone);
    if (!normalized) {
      result.unrecoverable.push({ id: u.id, role: u.role, name: u.fullNameEn, raw: phone });
      continue;
    }
    result.fixed.push({ id: u.id, role: u.role, from: phone, to: normalized });
    if (opts.apply) {
      await deps.db.user.update({ where: { id: u.id }, data: { phone: normalized } });
      await deps.db.auditLog.create({
        data: {
          actorId: SYSTEM_USER_ID,
          entityType: 'User',
          entityId: u.id,
          action: AuditAction.UPDATE,
          after: { event: 'PHONE_BACKFILL_NORMALIZED', from: phone, to: normalized },
        },
      });
    }
  }

  log(`[phone-fix] mode=${opts.apply ? 'APPLY' : 'DRY-RUN'}`);
  log(`  users scanned:      ${result.scanned}`);
  log(`  malformed phones:   ${result.malformed}`);
  log(`  ${opts.apply ? 'fixed' : 'would fix'}:          ${result.fixed.length}`);
  for (const f of result.fixed) {
    log(`    - ${f.id} (${f.role}): ${mask(f.from)} → ${mask(f.to)}`);
  }
  log(
    `  unrecoverable:      ${result.unrecoverable.length} (manual correction — full value in the DB)`,
  );
  for (const u2 of result.unrecoverable) {
    log(`    - ${u2.id} (${u2.role}) ${u2.name}: ${mask(u2.raw)}`);
  }

  if (opts.apply && result.fixed.length > 0) {
    await deps.db.auditLog.create({
      data: {
        actorId: SYSTEM_USER_ID,
        entityType: 'User',
        entityId: 'phone-backfill',
        action: AuditAction.UPDATE,
        after: {
          event: 'PHONE_BACKFILL_COMPLETED',
          fixed: result.fixed.length,
          unrecoverable: result.unrecoverable.length,
          ids: result.fixed.map((f) => f.id),
        },
      },
    });
  }
  return result;
}

// ─── CLI ───────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('fix-international-phones.ts')) {
  runPhoneFix({ db: db as unknown as PhoneFixDb }, { apply: process.argv.includes('--apply') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`[phone-fix] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    })
    .finally(() => (db as unknown as { $disconnect(): Promise<void> }).$disconnect());
}
