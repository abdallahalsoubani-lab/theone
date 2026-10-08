#!/usr/bin/env tsx
/**
 * Re-download inbound WhatsApp attachments that FAILED on the provider fetch
 * (P62-session follow-up, 08/10). Production evidence: 8 of ~120 attachments
 * ended «تعذّر تنزيل المرفق» with `provider fetch 404` fired within a second of
 * the webhook — Twilio announced the media before it was readable. The store
 * now retries that; this script recovers the rows that already died.
 *
 * The webhook URL was never stored (P55/P56 rule), so the media list is
 * re-read from the provider by the message's provider id and each item is
 * fetched again through the NORMAL store path (allowlist + size cap + object
 * storage + STORED). Nothing bypasses the policy.
 *
 * Usage (VM):
 *   pnpm dotenv -e .env.local -- tsx scripts/retry-inbound-media.ts                 # dry-run
 *   pnpm dotenv -e .env.local -- tsx scripts/retry-inbound-media.ts --apply
 *   pnpm dotenv -e .env.local -- tsx scripts/retry-inbound-media.ts --apply --id=<attachmentId>
 *   --all-failed   also retry other fetch failures (never oversize / disallowed —
 *                  those are policy verdicts, not transport ones)
 *
 * Output is ids + content types + reasons only — never a phone or a name.
 */
import { db } from '@/lib/db';
import { whatsapp } from '@/lib/whatsapp';
import { baseContentType } from '@/lib/whatsapp/media/policy';
import { storeInboundMedia } from '@/lib/whatsapp/media/store';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const allFailed = process.argv.includes('--all-failed');
  const idArg = process.argv.find((a) => a.startsWith('--id='))?.slice('--id='.length);
  console.log(
    apply ? '── APPLYING — re-downloading ──' : '── DRY RUN — nothing will be written ──',
  );

  if (!whatsapp.listMessageMedia) {
    console.error(`provider=${whatsapp.id} cannot list message media — nothing to do`);
    process.exit(2);
  }
  const listMessageMedia = whatsapp.listMessageMedia.bind(whatsapp);

  const rows = await db.whatsAppAttachment.findMany({
    where: {
      status: 'FAILED',
      ...(idArg ? { id: idArg } : {}),
      ...(allFailed
        ? {
            NOT: [
              { failureReason: { startsWith: 'exceeds' } },
              { failureReason: { startsWith: 'disallowed' } },
            ],
          }
        : { failureReason: { startsWith: 'provider fetch 404' } }),
    },
    select: {
      id: true,
      mediaIndex: true,
      contentType: true,
      failureReason: true,
      receivedAt: true,
      message: { select: { id: true, providerMessageId: true } },
    },
    orderBy: { receivedAt: 'asc' },
  });
  console.log(`candidates: ${rows.length}`);

  let stored = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of rows) {
    const sid = r.message.providerMessageId;
    if (!sid) {
      console.log(`  ${r.id} — no provider message id, skip`);
      skipped += 1;
      continue;
    }
    let items: Awaited<ReturnType<typeof listMessageMedia>>;
    try {
      items = await listMessageMedia(sid);
    } catch (err) {
      console.log(
        `  ${r.id} — provider list failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      skipped += 1;
      continue;
    }
    // Match by webhook index when the type agrees (or the message has a
    // single item); otherwise by a unique content type. Never guess.
    const byIndex = items[r.mediaIndex];
    const sameType = items.filter((i) => baseContentType(i.contentType) === r.contentType);
    const pick =
      byIndex && (items.length === 1 || baseContentType(byIndex.contentType) === r.contentType)
        ? byIndex
        : sameType.length === 1
          ? sameType[0]
          : undefined;
    if (!pick) {
      console.log(
        `  ${r.id} — no matching media on provider (items=${items.length}, idx=${r.mediaIndex}, type=${r.contentType})`,
      );
      skipped += 1;
      continue;
    }
    console.log(
      `  ${r.id} received=${r.receivedAt.toISOString()} idx=${r.mediaIndex} type=${r.contentType} reason="${r.failureReason ?? ''}" → provider item #${pick.index} ${pick.contentType}`,
    );
    if (!apply) continue;

    await db.whatsAppAttachment.update({
      where: { id: r.id },
      data: { status: 'PENDING', failureReason: null },
    });
    // Single final attempt: a fresh 404 now means the provider really has
    // nothing for us, and the row goes back to FAILED with that reason.
    const result = await storeInboundMedia({ attachmentId: r.id, mediaUrl: pick.url }, fetch, {
      attempt: 1,
      maxAttempts: 1,
    });
    if (result.status === 'STORED') stored += 1;
    else failed += 1;
    console.log(`    → ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
  }

  console.log(
    `\nsummary: candidates=${rows.length} stored=${stored} failed=${failed} skipped=${skipped}${
      apply ? '' : ' (dry-run — nothing written)'
    }`,
  );
  await db.$disconnect();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
