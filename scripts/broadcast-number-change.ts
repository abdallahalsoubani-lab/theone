/**
 * P57 — one-off WhatsApp broadcast: clinic number-change notice.
 *
 *   pnpm tsx scripts/broadcast-number-change.ts --load <path>   # one-time CSV load
 *   pnpm tsx scripts/broadcast-number-change.ts                 # dry-run (default)
 *   pnpm tsx scripts/broadcast-number-change.ts --apply         # daily send run
 *   pnpm tsx scripts/broadcast-number-change.ts --report        # campaign report
 *   flags: --cap <n> (default 425)   --ignore-window (loud warning)
 *
 * Contract (Prompt 57 + 57b — owner decisions, verbatim):
 *   - Recipients come ONLY from the owner-supplied CSV (`phone,name`, E.164,
 *     JO-first order). The CSV is PII: never committed (.gitignore), read
 *     from an absolute path on the VM, deleted after the campaign.
 *   - Fixed-body Arabic template `clinic_number_change_notice` (Twilio
 *     Content SID below), zero variables, existing production sender.
 *   - Daily cap 425, send window 10:00–18:00 Asia/Amman (10:00 inclusive,
 *     18:00 EXCLUSIVE), one message per second, manual morning runs — no
 *     cron, no BullMQ.
 *   - Sends go DIRECTLY through the provider module (lib/whatsapp factory):
 *     admin-initiated manual broadcast = the P51 "human/exempt" category.
 *     This file must never import lib/whatsapp/silent-mode, lib/whatsapp/
 *     dispatch or the appointment-message paths (asserted by tests).
 *   - Idempotency backbone: @@unique([campaign, phone]) + only PENDING rows
 *     are ever selected. A crash mid-run is safe; same-day re-apply counts
 *     today's SENT rows toward the cap.
 *   - Every accepted send writes a WhatsAppMessage row (providerMessageId =
 *     Twilio SID) so the EXISTING status webhook resolves delivery — zero
 *     webhook changes. Deliberately NO WhatsAppConversation bump: 1,689
 *     upserts would flood the P49 inbox; a recipient's reply creates the
 *     conversation naturally and the thread view keys messages by phone,
 *     so the broadcast message still shows in the thread (pinned by test).
 *   - Auto-stop rails: Twilio 63018 (per-day messaging limit — the row that
 *     tripped it stays PENDING) and failure spikes (≥10 consecutive, or
 *     >15% over the last 100 attempts).
 *   - P57b canary: after EVERY --apply that passes the guards (normal end,
 *     cap-exhausted, and auto-stop aborts alike) one extra template send
 *     goes to the owner's phone — outside the recipient table, outside the
 *     cap. A canary failure never fails the run. Dry-run and --report never
 *     fire it.
 *   - Console output is English by decision (§3.7); phones print masked
 *     (last 3 digits) — the full number never reaches the console.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AuditAction, type Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { SYSTEM_USER_ID } from '@/lib/system/actor';
import { clinicDayRange, clinicWallParts } from '@/lib/time/clinic';
import { whatsapp } from '@/lib/whatsapp';
import { WhatsAppError, describeWhatsAppError } from '@/lib/whatsapp/errors';
import type { SendResult } from '@/lib/whatsapp/provider';
import { isTemplateApproved } from '@/lib/whatsapp/templates/approval';
import { syncTemplateApproval } from '@/lib/whatsapp/templates/approvalSync';

// ─── Campaign constants (owner decisions §1) ───────────────────────────────

export const CAMPAIGN = 'clinic_number_change_2026_08';
export const TEMPLATE_NAME = 'clinic_number_change_notice';
export const TEMPLATE_LANGUAGE = 'AR' as const;
export const TEMPLATE_SID = 'HXe832cda2ae43ab2062ea0bb71ff7bc1b';
/** P57b — the OWNER's phone. One extra template send per --apply run lands
 *  here as a "the batch ran" confirmation. Hardcoded by decision (§2.1). */
export const CANARY_PHONE = '+962787075008';
export const DEFAULT_DAILY_CAP = 425;
/** Send window, clinic wall clock: start inclusive, end EXCLUSIVE. */
export const WINDOW_START_HOUR = 10;
export const WINDOW_END_HOUR = 18;
/** Sequential pacing between sends (§3.4) — deliberate gentleness. */
export const PACE_MS = 1_000;
export const MAX_CONSECUTIVE_FAILURES = 10;
export const SPIKE_WINDOW = 100;
export const SPIKE_MAX_FAILURES = 15; // >15% over the last 100 attempts
export const TWILIO_DAILY_LIMIT_CODE = 63018;

const E164 = /^\+[1-9]\d{7,14}$/;

/** Admin-log display body. The authoritative body is the WhatsApp-approved
 *  template stored at Twilio under TEMPLATE_SID (fixed text, no variables). */
const CONTENT_PREVIEW =
  'إشعار انتقال المركز الأول للعلاج الطبيعي وتغيير أرقام الهاتف — نص القالب المعتمد محفوظ لدى واتساب';

// ─── Injectable dependencies ───────────────────────────────────────────────

interface RecipientRow {
  id: string;
  phone: string;
  name: string | null;
  messageId?: string | null;
  failReason?: string | null;
}

export interface BroadcastDb {
  broadcastRecipient: {
    createMany(args: {
      data: Array<{ campaign: string; phone: string; name: string | null }>;
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    count(args: {
      where: {
        campaign: string;
        status?: 'PENDING' | 'SENT';
        sentAt?: { gte: Date; lt: Date };
      };
    }): Promise<number>;
    findMany(args: {
      where: { campaign: string; status: 'PENDING' | 'SENT' | 'FAILED' };
      orderBy?: Array<Record<string, 'asc'>>;
      take?: number;
      select: Record<string, boolean>;
    }): Promise<RecipientRow[]>;
    update(args: {
      where: { id: string };
      data: {
        status: 'SENT' | 'FAILED';
        sentAt?: Date;
        messageId?: string | null;
        failReason?: string;
      };
    }): Promise<unknown>;
    groupBy(args: {
      by: ['status'];
      where: { campaign: string };
      _count: { _all: true };
    }): Promise<Array<{ status: string; _count: { _all: number } }>>;
  };
  whatsAppMessage: {
    create(args: {
      data: {
        templateId: string | null;
        recipientId: null;
        recipientPhone: string;
        parameters: Prisma.InputJsonValue;
        direction: 'OUTBOUND';
        status: 'SENT';
        providerMessageId: string | null;
        body: string;
        appointmentId: null;
        sentAt: Date;
      };
    }): Promise<{ id: string }>;
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: boolean; status: boolean };
    }): Promise<Array<{ id: string; status: string }>>;
  };
  whatsAppTemplate: {
    upsert(args: {
      where: { name_language: { name: string; language: 'AR' } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<{ id: string }>;
    findUnique(args: {
      where: { name_language: { name: string; language: 'AR' } };
      select: { id: boolean };
    }): Promise<{ id: string } | null>;
  };
  auditLog: {
    create(args: {
      data: {
        actorId: string;
        entityType: string;
        entityId: string;
        action: AuditAction;
        after: Prisma.InputJsonValue;
      };
    }): Promise<unknown>;
  };
}

export interface BroadcastProvider {
  sendTemplate(params: {
    name: string;
    language: 'AR';
    recipientPhone: string;
    parameters: ReadonlyArray<string>;
  }): Promise<SendResult>;
  healthCheck(): Promise<boolean>;
}

export interface BroadcastDeps {
  db: BroadcastDb;
  provider: BroadcastProvider;
  syncApproval: typeof syncTemplateApproval;
  isApproved: typeof isTemplateApproved;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string) => void;
}

export function defaultDeps(): BroadcastDeps {
  return {
    db: db as unknown as BroadcastDb,
    provider: whatsapp,
    syncApproval: syncTemplateApproval,
    isApproved: isTemplateApproved,
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (msg) => console.log(msg),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Mask a phone to its last 3 digits — the console never sees a full number. */
export function maskPhone(phone: string): string {
  if (phone.length <= 3) return phone;
  return '*'.repeat(phone.length - 3) + phone.slice(-3);
}

/** Send-window check on the clinic wall clock: 10:00 ≤ t < 18:00 Amman. */
export function isInsideSendWindow(now: Date): boolean {
  const { hour } = clinicWallParts(now);
  return hour >= WINDOW_START_HOUR && hour < WINDOW_END_HOUR;
}

export function isDailyLimitError(err: unknown): boolean {
  if (!(err instanceof WhatsAppError)) return false;
  const raw = err.providerCode;
  const code = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  return code === TWILIO_DAILY_LIMIT_CODE;
}

async function audit(deps: BroadcastDeps, action: AuditAction, after: Prisma.InputJsonValue) {
  await deps.db.auditLog
    .create({
      data: {
        actorId: SYSTEM_USER_ID,
        entityType: 'BroadcastRecipient',
        entityId: CAMPAIGN,
        action,
        after,
      },
    })
    .catch((err: unknown) => deps.log(`[broadcast] audit write failed: ${String(err)}`));
}

// ─── CSV parsing (--load) ──────────────────────────────────────────────────

export interface ParsedCsv {
  rows: Array<{ phone: string; name: string | null }>;
  rejected: Array<{ line: number; reason: string }>;
}

/**
 * Parse the campaign CSV: header `phone,name`, one recipient per line. The
 * name may contain commas; only the FIRST comma splits. Surrounding quotes
 * are stripped. Anything that is not strict E.164 is rejected with its line
 * number — the upstream list is trusted but format is validated defensively.
 */
export function parseCampaignCsv(content: string): ParsedCsv {
  const rows: ParsedCsv['rows'] = [];
  const rejected: ParsedCsv['rejected'] = [];
  const seen = new Set<string>();
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);

  const unquote = (s: string): string => {
    const t = s.trim();
    return t.startsWith('"') && t.endsWith('"') && t.length >= 2
      ? t.slice(1, -1).replace(/""/g, '"').trim()
      : t;
  };

  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    if (rawLine.trim() === '') return;
    if (lineNo === 1 && /^\s*"?phone"?\s*,/i.test(rawLine)) return; // header
    const idx = rawLine.indexOf(',');
    const phone = unquote(idx === -1 ? rawLine : rawLine.slice(0, idx));
    const name = idx === -1 ? '' : unquote(rawLine.slice(idx + 1));
    if (!E164.test(phone)) {
      rejected.push({ line: lineNo, reason: `not E.164 (${maskPhone(phone) || 'empty'})` });
      return;
    }
    if (seen.has(phone)) {
      rejected.push({ line: lineNo, reason: `duplicate of an earlier line (${maskPhone(phone)})` });
      return;
    }
    seen.add(phone);
    rows.push({ phone, name: name === '' ? null : name });
  });
  return { rows, rejected };
}

// ─── --load ────────────────────────────────────────────────────────────────

export interface LoadResult {
  total: number;
  inserted: number;
  alreadyPresent: number;
  rejected: number;
}

/**
 * One-time load: registers the template row (idempotent upsert; never
 * clobbers twilioApproved — the live sync owns that flag) and inserts
 * PENDING recipients. `createMany(skipDuplicates)` is the whole idempotency
 * story: an existing (campaign, phone) row — PENDING, SENT or FAILED — is
 * never touched, so a re-load can neither duplicate nor reset state.
 * Rows are created in CSV order; cuids are generated sequentially, so
 * `orderBy createdAt, id` at send time replays the CSV order (JO first).
 */
export async function loadCampaign(deps: BroadcastDeps, filePath: string): Promise<LoadResult> {
  const content = readFileSync(resolve(filePath), 'utf8');
  const { rows, rejected } = parseCampaignCsv(content);

  await deps.db.whatsAppTemplate.upsert({
    where: { name_language: { name: TEMPLATE_NAME, language: TEMPLATE_LANGUAGE } },
    create: {
      name: TEMPLATE_NAME,
      language: TEMPLATE_LANGUAGE,
      category: 'GENERAL',
      contentPreview: CONTENT_PREVIEW,
      active: true,
      variablesShape: [],
      twilioContentSid: TEMPLATE_SID,
      twilioApproved: false, // flipped by the live approval sync at run time
    },
    update: { twilioContentSid: TEMPLATE_SID, active: true },
  });

  const created = await deps.db.broadcastRecipient.createMany({
    data: rows.map((r) => ({ campaign: CAMPAIGN, phone: r.phone, name: r.name })),
    skipDuplicates: true,
  });

  const result: LoadResult = {
    total: rows.length + rejected.length,
    inserted: created.count,
    alreadyPresent: rows.length - created.count,
    rejected: rejected.length,
  };

  deps.log(`[broadcast] --load ${CAMPAIGN}`);
  deps.log(`  lines read:       ${result.total}`);
  deps.log(`  newly inserted:   ${result.inserted}`);
  deps.log(`  already present:  ${result.alreadyPresent}`);
  deps.log(`  rejected lines:   ${result.rejected}`);
  for (const r of rejected) deps.log(`    line ${r.line}: ${r.reason}`);

  await audit(deps, AuditAction.CREATE, {
    event: 'BROADCAST_LOAD',
    campaign: CAMPAIGN,
    ...result,
  });
  return result;
}

// ─── Guards shared by dry-run + apply ──────────────────────────────────────

async function checkApproval(deps: BroadcastDeps): Promise<boolean> {
  // Live re-check against Twilio's ApprovalRequests API via the existing
  // sync service (it updates WhatsAppTemplate.twilioApproved — template
  // metadata, not campaign state). A transient sync failure falls back to
  // the stored flag.
  await deps
    .syncApproval([{ name: TEMPLATE_NAME, language: TEMPLATE_LANGUAGE, sid: TEMPLATE_SID }])
    .catch((err: unknown) => deps.log(`[broadcast] approval sync failed: ${String(err)}`));
  return deps.isApproved(TEMPLATE_NAME, TEMPLATE_LANGUAGE);
}

// ─── dry-run (default mode) ────────────────────────────────────────────────

export async function dryRun(deps: BroadcastDeps, cap: number): Promise<void> {
  const now = deps.now();
  const pending = await deps.db.broadcastRecipient.count({
    where: { campaign: CAMPAIGN, status: 'PENDING' },
  });
  const today = clinicDayRange(now);
  const sentToday = await deps.db.broadcastRecipient.count({
    where: { campaign: CAMPAIGN, status: 'SENT', sentAt: { gte: today.start, lt: today.end } },
  });
  const budget = Math.max(0, cap - sentToday);
  const inside = isInsideSendWindow(now);
  const { hour, minute } = clinicWallParts(now);
  const approved = await checkApproval(deps);

  deps.log(
    `[broadcast] DRY-RUN — ${CAMPAIGN} (no sends, no campaign writes; only the template-approval flag re-syncs)`,
  );
  deps.log(`  pending:          ${pending}`);
  deps.log(`  sent today:       ${sentToday} (cap ${cap} → next --apply sends up to ${budget})`);
  deps.log(
    `  send window:      ${inside ? 'INSIDE' : 'OUTSIDE'} — Amman time ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (window ${WINDOW_START_HOUR}:00–${WINDOW_END_HOUR}:00, end exclusive)`,
  );
  deps.log(
    `  template:         ${TEMPLATE_NAME}/AR ${approved ? 'APPROVED' : 'NOT APPROVED — --apply will refuse'}`,
  );

  const preview = await deps.db.broadcastRecipient.findMany({
    where: { campaign: CAMPAIGN, status: 'PENDING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: budget,
    select: { id: true, phone: true, name: true },
  });
  deps.log(`  next --apply would send to ${preview.length} number(s):`);
  for (let i = 0; i < preview.length; i += 8) {
    deps.log(
      `    ${preview
        .slice(i, i + 8)
        .map((r) => maskPhone(r.phone))
        .join('  ')}`,
    );
  }
  deps.log(`  canary:           NOT fired on dry-run (P57b — --apply only)`);
}

// ─── --apply ───────────────────────────────────────────────────────────────

export interface RunSummary {
  attempted: number;
  sent: number;
  failed: number;
  remainingPending: number;
  aborted: string | null;
  canary: string; // 'sent' | 'failed: …' | 'skipped: guard <reason>'
}

async function resolveTemplateRowId(deps: BroadcastDeps): Promise<string | null> {
  const row = await deps.db.whatsAppTemplate.findUnique({
    where: { name_language: { name: TEMPLATE_NAME, language: TEMPLATE_LANGUAGE } },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Write the WhatsAppMessage row that lets the EXISTING Twilio status
 * webhook resolve delivery for this send (matched by providerMessageId).
 * recipientId/appointmentId stay null — the status handler only uses them
 * when present. Deliberately NO WhatsAppConversation upsert (see header).
 */
async function createMessageRow(
  deps: BroadcastDeps,
  args: { phone: string; providerMessageId: string | null; templateRowId: string | null; at: Date },
): Promise<string | null> {
  try {
    const row = await deps.db.whatsAppMessage.create({
      data: {
        templateId: args.templateRowId,
        recipientId: null,
        recipientPhone: args.phone,
        parameters: {},
        direction: 'OUTBOUND',
        status: 'SENT',
        providerMessageId: args.providerMessageId,
        body: CONTENT_PREVIEW,
        appointmentId: null,
        sentAt: args.at,
      },
    });
    return row.id;
  } catch (err) {
    // Provider already accepted — a bookkeeping failure must never cause a
    // re-send (P50 C-3 lesson). Log loudly and move on.
    deps.log(
      `[broadcast] WARNING: message row write failed for ${maskPhone(args.phone)} — delivery status will not resolve for this send: ${String(err)}`,
    );
    return null;
  }
}

/** P57b — fire the owner canary. Never throws; the run result is a string. */
async function sendCanary(deps: BroadcastDeps, templateRowId: string | null): Promise<string> {
  try {
    const result = await deps.provider.sendTemplate({
      name: TEMPLATE_NAME,
      language: TEMPLATE_LANGUAGE,
      recipientPhone: CANARY_PHONE,
      parameters: [],
    });
    if (result.status === 'FAILED') {
      return `failed: ${result.failureReason ?? 'provider returned FAILED'}`;
    }
    await createMessageRow(deps, {
      phone: CANARY_PHONE,
      providerMessageId: result.providerMessageId,
      templateRowId,
      at: deps.now(),
    });
    return 'sent';
  } catch (err) {
    return `failed: ${describeWhatsAppError(err)}`;
  }
}

export interface ApplyOptions {
  cap?: number;
  ignoreWindow?: boolean;
}

export async function applyRun(deps: BroadcastDeps, opts: ApplyOptions = {}): Promise<RunSummary> {
  const cap = opts.cap ?? DEFAULT_DAILY_CAP;
  const now = deps.now();

  const finishGuardAbort = async (reason: string, message: string): Promise<RunSummary> => {
    deps.log(`[broadcast] REFUSED — ${message}`);
    const summary: RunSummary = {
      attempted: 0,
      sent: 0,
      failed: 0,
      remainingPending: await deps.db.broadcastRecipient.count({
        where: { campaign: CAMPAIGN, status: 'PENDING' },
      }),
      aborted: reason,
      canary: `skipped: guard ${reason}`,
    };
    await audit(deps, AuditAction.UPDATE, {
      event: 'BROADCAST_RUN',
      campaign: CAMPAIGN,
      cap,
      ...summary,
    });
    return summary;
  };

  // Guard 1 — send window (clinic wall clock).
  if (!isInsideSendWindow(now)) {
    const { hour, minute } = clinicWallParts(now);
    const at = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (!opts.ignoreWindow) {
      return finishGuardAbort(
        'OUTSIDE_WINDOW',
        `outside the send window: Amman time is ${at}, window is ${WINDOW_START_HOUR}:00–${WINDOW_END_HOUR}:00 (end exclusive). Re-run inside the window, or --ignore-window to override.`,
      );
    }
    deps.log(
      `[broadcast] ⚠️⚠️ --ignore-window: sending OUTSIDE the ${WINDOW_START_HOUR}:00–${WINDOW_END_HOUR}:00 Amman window (now ${at}). Patients may be messaged at an unsociable hour. ⚠️⚠️`,
    );
  }

  // Guard 2 — the template must be live-Approved (25/08 lesson: a template
  // that regressed to pending is a HARD send failure, not a delay).
  if (!(await checkApproval(deps))) {
    return finishGuardAbort(
      'TEMPLATE_NOT_APPROVED',
      `template ${TEMPLATE_NAME}/AR is not WhatsApp-approved (live check). A pending/rejected template is a hard send failure — check Twilio Console → Content Editor and re-run once approved.`,
    );
  }

  // Guard 3 — provider health (credentials + template SID mapping).
  if (!(await deps.provider.healthCheck())) {
    return finishGuardAbort(
      'PROVIDER_HEALTH',
      'provider health check failed — see the [whatsapp.twilio] warnings above (credentials or template SID mapping).',
    );
  }

  // Cap accounting: today's already-SENT rows count toward the cap, so a
  // crash-resume same-day re-apply continues instead of doubling the batch.
  const today = clinicDayRange(now);
  const sentToday = await deps.db.broadcastRecipient.count({
    where: { campaign: CAMPAIGN, status: 'SENT', sentAt: { gte: today.start, lt: today.end } },
  });
  const budget = Math.max(0, cap - sentToday);

  const pendingBefore = await deps.db.broadcastRecipient.count({
    where: { campaign: CAMPAIGN, status: 'PENDING' },
  });
  await audit(deps, AuditAction.UPDATE, {
    event: 'BROADCAST_RUN_STARTED',
    campaign: CAMPAIGN,
    cap,
    sentToday,
    budget,
    pending: pendingBefore,
  });
  deps.log(
    `[broadcast] --apply ${CAMPAIGN}: pending=${pendingBefore} sentToday=${sentToday} cap=${cap} → sending up to ${budget}`,
  );

  const templateRowId = await resolveTemplateRowId(deps);
  const rows = await deps.db.broadcastRecipient.findMany({
    where: { campaign: CAMPAIGN, status: 'PENDING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // CSV order — JO first, intl last
    take: budget,
    select: { id: true, phone: true, name: true },
  });

  let sent = 0;
  let failed = 0;
  let attempted = 0;
  let aborted: string | null = null;
  let consecutiveFailures = 0;
  const recentOutcomes: boolean[] = []; // true = failure, sliding last-100
  const failReasons = new Map<string, number>();

  const noteFailure = (reason: string): void => {
    failed += 1;
    consecutiveFailures += 1;
    failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1);
  };

  for (const [i, row] of rows.entries()) {
    attempted += 1;
    let failure: string | null = null;
    try {
      const result = await deps.provider.sendTemplate({
        name: TEMPLATE_NAME,
        language: TEMPLATE_LANGUAGE,
        recipientPhone: row.phone,
        parameters: [],
      });
      if (result.status === 'FAILED') {
        failure = result.failureReason ?? 'provider returned FAILED';
      } else {
        const at = deps.now();
        const messageId = await createMessageRow(deps, {
          phone: row.phone,
          providerMessageId: result.providerMessageId,
          templateRowId,
          at,
        });
        try {
          await deps.db.broadcastRecipient.update({
            where: { id: row.id },
            data: { status: 'SENT', sentAt: at, messageId },
          });
        } catch (err) {
          // The message went OUT — never leave the row selectable again.
          deps.log(
            `[broadcast] CRITICAL: sent to ${maskPhone(row.phone)} but could not mark SENT — mark it manually before the next run: ${String(err)}`,
          );
        }
        sent += 1;
        consecutiveFailures = 0;
      }
    } catch (err) {
      if (isDailyLimitError(err)) {
        // Twilio 63018 — the sender's daily tier is exhausted. The send did
        // not go through; the row STAYS PENDING for tomorrow.
        attempted -= 1;
        aborted = 'DAILY_LIMIT_63018';
        deps.log(
          `[broadcast] ABORT — Twilio 63018: the WhatsApp per-day messaging limit is reached; the daily tier is lower than the cap. Rerun tomorrow — consider --cap 250.`,
        );
        break;
      }
      failure = describeWhatsAppError(err);
    }

    if (failure !== null) {
      noteFailure(failure);
      await deps.db.broadcastRecipient
        .update({ where: { id: row.id }, data: { status: 'FAILED', failReason: failure } })
        .catch((err: unknown) =>
          deps.log(
            `[broadcast] failed-row bookkeeping error for ${maskPhone(row.phone)}: ${String(err)}`,
          ),
        );
      deps.log(`[broadcast] FAILED ${maskPhone(row.phone)}: ${failure}`);
    }

    recentOutcomes.push(failure !== null);
    if (recentOutcomes.length > SPIKE_WINDOW) recentOutcomes.shift();

    // Auto-stop rails (§3.5) — protect the sender's quality rating; the
    // same number carries every daily appointment reminder.
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      aborted = 'FAILURE_SPIKE_CONSECUTIVE';
    } else if (
      recentOutcomes.length >= SPIKE_WINDOW &&
      recentOutcomes.filter(Boolean).length > SPIKE_MAX_FAILURES
    ) {
      aborted = 'FAILURE_SPIKE_RATE';
    }
    if (aborted) {
      const dominant = [...failReasons.entries()].sort((a, b) => b[1] - a[1])[0];
      deps.log(
        `[broadcast] ABORT — ${aborted}: dominant failure reason: ${dominant ? `"${dominant[0]}" ×${dominant[1]}` : 'n/a'}. Remaining rows stay PENDING for tomorrow.`,
      );
      break;
    }

    if (i < rows.length - 1) await deps.sleep(PACE_MS);
  }

  // P57b — the canary fires on EVERY run that passed the guards: normal
  // completion, cap-exhausted no-op, and auto-stop aborts alike. The owner's
  // rule: "message on my WhatsApp ≈ the batch ran".
  const canary = await sendCanary(deps, templateRowId);
  deps.log(`[broadcast] canary: ${canary === 'sent' ? 'sent ✓' : canary}`);

  const remainingPending = await deps.db.broadcastRecipient.count({
    where: { campaign: CAMPAIGN, status: 'PENDING' },
  });
  const summary: RunSummary = { attempted, sent, failed, remainingPending, aborted, canary };
  await audit(deps, AuditAction.UPDATE, {
    event: 'BROADCAST_RUN',
    campaign: CAMPAIGN,
    cap,
    sentToday,
    ...summary,
  });

  const daysLeft = remainingPending === 0 ? 0 : Math.ceil(remainingPending / cap);
  deps.log(`[broadcast] run summary — ${CAMPAIGN}`);
  deps.log(`  attempted:         ${attempted}`);
  deps.log(`  sent:              ${sent}`);
  deps.log(`  failed:            ${failed}`);
  deps.log(`  remaining PENDING: ${remainingPending} (≈ ${daysLeft} more day(s) at cap ${cap})`);
  deps.log(`  aborted:           ${aborted ?? 'no'}`);
  deps.log(`  canary:            ${canary === 'sent' ? 'sent ✓' : canary}`);
  return summary;
}

// ─── --report ──────────────────────────────────────────────────────────────

export interface ReportResult {
  totals: Record<string, number>;
  delivery: { delivered: number; read: number; inTransit: number; failedAfterAccept: number };
  failureReasons: Array<{ reason: string; count: number }>;
  failedCsvPath: string | null;
}

export async function reportRun(
  deps: BroadcastDeps,
  outDir: string = process.cwd(),
): Promise<ReportResult> {
  const grouped = await deps.db.broadcastRecipient.groupBy({
    by: ['status'],
    where: { campaign: CAMPAIGN },
    _count: { _all: true },
  });
  const totals: Record<string, number> = { PENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 };
  for (const g of grouped) totals[g.status] = g._count._all;

  // Delivery — joined from the linked WhatsAppMessage rows, which the
  // existing status webhook keeps current (lags by design; re-run anytime).
  const sentWithMessage = await deps.db.broadcastRecipient.findMany({
    where: { campaign: CAMPAIGN, status: 'SENT' },
    select: { messageId: true },
  });
  const messageIds = sentWithMessage.map((r) => r.messageId).filter((id): id is string => !!id);
  const delivery = { delivered: 0, read: 0, inTransit: 0, failedAfterAccept: 0 };
  const CHUNK = 500;
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const messages = await deps.db.whatsAppMessage.findMany({
      where: { id: { in: messageIds.slice(i, i + CHUNK) } },
      select: { id: true, status: true },
    });
    for (const m of messages) {
      if (m.status === 'DELIVERED') delivery.delivered += 1;
      else if (m.status === 'READ') delivery.read += 1;
      else if (m.status === 'FAILED') delivery.failedAfterAccept += 1;
      else delivery.inTransit += 1;
    }
  }

  const failedRows = await deps.db.broadcastRecipient.findMany({
    where: { campaign: CAMPAIGN, status: 'FAILED' },
    orderBy: [{ createdAt: 'asc' }],
    select: { phone: true, failReason: true },
  });
  const reasonCounts = new Map<string, number>();
  for (const r of failedRows) {
    const reason = r.failReason ?? 'unknown';
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const failureReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  let failedCsvPath: string | null = null;
  if (failedRows.length > 0) {
    failedCsvPath = resolve(outDir, 'broadcast-failed.csv');
    const csv = ['phone_masked,reason']
      .concat(
        failedRows.map(
          (r) => `${maskPhone(r.phone)},"${(r.failReason ?? 'unknown').replace(/"/g, '""')}"`,
        ),
      )
      .join('\n');
    writeFileSync(failedCsvPath, csv + '\n', 'utf8');
  }

  deps.log(`[broadcast] REPORT — ${CAMPAIGN}`);
  deps.log(
    `  totals:   PENDING=${totals.PENDING} SENT=${totals.SENT} FAILED=${totals.FAILED} SKIPPED=${totals.SKIPPED}`,
  );
  deps.log(
    `  delivery: delivered=${delivery.delivered} read=${delivery.read} in-transit=${delivery.inTransit} provider-failed-after-accept=${delivery.failedAfterAccept}`,
  );
  deps.log(
    `            (delivery lags — it fills in as Twilio status callbacks arrive; re-run anytime)`,
  );
  if (failureReasons.length > 0) {
    deps.log('  failure reasons:');
    for (const f of failureReasons.slice(0, 10)) deps.log(`    ×${f.count}  ${f.reason}`);
  }
  if (failedCsvPath)
    deps.log(`  failed list written (masked): ${failedCsvPath} — VM only, never commit`);
  deps.log('  canary sends are not part of these counts (no recipient row — P57b)');

  return { totals, delivery, failureReasons, failedCsvPath };
}

// ─── CLI ───────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith('broadcast-number-change.ts')) {
  const argv = process.argv.slice(2);
  const getFlagValue = (flag: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`${flag}=`))?.split('=')[1];
    if (eq) return eq;
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const capRaw = getFlagValue('--cap');
  const cap = capRaw ? Number.parseInt(capRaw, 10) : DEFAULT_DAILY_CAP;
  if (!Number.isFinite(cap) || cap < 1) {
    console.error(`--cap must be a positive integer (got: ${capRaw})`);
    process.exit(1);
  }
  const deps = defaultDeps();

  const run = async (): Promise<number> => {
    const loadPath =
      argv.includes('--load') || argv.some((a) => a.startsWith('--load='))
        ? getFlagValue('--load')
        : undefined;
    if (argv.includes('--load') && !loadPath) {
      console.error('--load requires a path: --load <path-to-csv>');
      return 1;
    }
    if (loadPath) {
      await loadCampaign(deps, loadPath);
      return 0;
    }
    if (argv.includes('--report')) {
      await reportRun(deps);
      return 0;
    }
    if (argv.includes('--apply')) {
      const summary = await applyRun(deps, { cap, ignoreWindow: argv.includes('--ignore-window') });
      // Non-zero only when a guard refused the run outright — an auto-stop
      // mid-batch still exits 0 (partial progress + canary + audit are real).
      return summary.aborted !== null && summary.attempted === 0 && summary.sent === 0 ? 1 : 0;
    }
    await dryRun(deps, cap);
    return 0;
  };

  run()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[broadcast] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    })
    .finally(() => (db as unknown as { $disconnect(): Promise<void> }).$disconnect());
}
