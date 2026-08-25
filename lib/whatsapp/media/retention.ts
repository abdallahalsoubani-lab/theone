import { DeleteObjectCommand } from '@aws-sdk/client-s3';

import { AuditAction } from '@prisma/client';

import { db } from '@/lib/db';
import { s3, STORAGE_BUCKET } from '@/lib/storage/client';
import { SYSTEM_USER_ID } from '@/lib/system/actor';

const DEFAULT_RETENTION_DAYS = 90;

/**
 * P56 — delete inbound WhatsApp media binaries older than the retention
 * window (ClinicSettings.whatsappMediaRetentionDays, default 90). The
 * WhatsAppMessage + WhatsAppAttachment ROWS stay (status → EXPIRED, deletedAt
 * set) so the thread renders an "attachment expired" marker; only the object
 * is removed. Idempotent (only STORED rows past the window are touched) and
 * audited in aggregate — one row per run with the counts.
 */
export async function runWhatsappMediaRetention(now: Date = new Date()): Promise<{
  deleted: number;
  failed: number;
  windowDays: number;
}> {
  const settings = await db.clinicSettings.findUnique({
    where: { id: 'default' },
    select: { whatsappMediaRetentionDays: true },
  });
  const windowDays = settings?.whatsappMediaRetentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const stale = await db.whatsAppAttachment.findMany({
    where: { status: 'STORED', deletedAt: null, receivedAt: { lt: cutoff } },
    select: { id: true, storageKey: true },
  });

  let deleted = 0;
  let failed = 0;
  for (const a of stale) {
    try {
      if (a.storageKey) {
        await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: a.storageKey }));
      }
      await db.whatsAppAttachment.update({
        where: { id: a.id },
        data: { status: 'EXPIRED', deletedAt: now, storageKey: null },
      });
      deleted += 1;
    } catch (err) {
      failed += 1;
      console.error('[wa-media-retention] delete failed', {
        attachmentId: a.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (deleted > 0 || failed > 0) {
    await db.auditLog
      .create({
        data: {
          actorId: SYSTEM_USER_ID,
          entityType: 'WhatsAppAttachment',
          entityId: 'retention',
          action: AuditAction.DELETE,
          after: { event: 'WA_MEDIA_RETENTION_RUN', windowDays, deleted, failed },
        },
      })
      .catch(() => undefined);
  }
  console.warn(
    `[wa-media-retention] window=${windowDays}d deleted=${deleted} failed=${failed} scanned=${stale.length}`,
  );
  return { deleted, failed, windowDays };
}
