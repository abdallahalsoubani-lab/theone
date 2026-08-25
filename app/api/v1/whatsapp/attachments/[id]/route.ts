import { GetObjectCommand } from '@aws-sdk/client-s3';
import { NextResponse, type NextRequest } from 'next/server';

import { db } from '@/lib/db';
import { ForbiddenError, requirePermission } from '@/lib/rbac/guards';
import { s3, STORAGE_BUCKET } from '@/lib/storage/client';

/**
 * P56 — serve ONE inbound WhatsApp attachment.
 *
 * GET /api/v1/whatsapp/attachments/{id}
 *
 * Privacy-critical: SECRETARY + ADMIN only — enforced HERE at the route
 * (can(), not just the UI), so a therapist/doctor session hitting the URL
 * directly is denied (P15 data-layer precedent). Nothing is cached to the
 * browser; bytes stream from the object store on each request. Range requests
 * are supported so video seeks without downloading the whole file.
 *
 * States: EXPIRED (retention-deleted) → 410; PENDING/FAILED/no key → 404.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requirePermission('whatsapp_attachments.read');
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
    }
    throw err;
  }

  const { id } = await params;
  const attachment = await db.whatsAppAttachment.findUnique({
    where: { id },
    select: { status: true, storageKey: true, contentType: true },
  });
  if (!attachment) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  if (attachment.status === 'EXPIRED') {
    return NextResponse.json({ error: { code: 'ATTACHMENT_EXPIRED' } }, { status: 410 });
  }
  if (attachment.status !== 'STORED' || !attachment.storageKey) {
    return NextResponse.json({ error: { code: 'NOT_READY' } }, { status: 404 });
  }

  const range = req.headers.get('range') ?? undefined;
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: attachment.storageKey,
        ...(range ? { Range: range } : {}),
      }),
    );
    if (!res.Body) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
    const bytes = await res.Body.transformToByteArray();
    const headers: Record<string, string> = {
      'content-type': attachment.contentType,
      'cache-control': 'no-store',
      'accept-ranges': 'bytes',
      'content-length': String(bytes.byteLength),
    };
    // When the store honored a Range, echo the 206 partial-content headers so
    // the browser's video element can seek.
    if (range && res.ContentRange) {
      headers['content-range'] = res.ContentRange;
      return new Response(new Uint8Array(bytes), { status: 206, headers });
    }
    return new Response(new Uint8Array(bytes), { status: 200, headers });
  } catch {
    return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }
}
