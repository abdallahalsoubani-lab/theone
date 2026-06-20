import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@/auth';
import { s3, STORAGE_BUCKET } from '@/lib/storage/client';
import { verifyUploadToken } from '@/lib/storage/uploadToken';

/**
 * Same-origin storage proxy (Fix Prompt 4). MinIO is localhost-only on the VM,
 * so direct browser↔MinIO transfer is impossible; this route streams between
 * the browser and MinIO via the server-side s3 client.
 *
 *   PUT  /api/v1/storage/<key>?t=<token>  — upload, authorized by the signed
 *        capability token (issued only after a can() check in createUploadUrl /
 *        createPendingDocument). Enforces the token's content-type + size.
 *   GET  /api/v1/storage/<key>            — read, session-gated, EXERCISE media
 *        only. Patient documents are PII and have their own permission-scoped
 *        route (/api/v1/documents/[id]); they are never served here.
 */

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  const key = (await params).key.join('/');
  const token = req.nextUrl.searchParams.get('t');
  if (!token) return NextResponse.json({ error: 'Missing upload token.' }, { status: 401 });

  const claims = await verifyUploadToken(token);
  if (!claims || claims.key !== key) {
    return NextResponse.json({ error: 'Invalid or expired upload token.' }, { status: 403 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType !== claims.contentType) {
    return NextResponse.json({ error: 'Content-Type does not match the grant.' }, { status: 400 });
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.byteLength === 0) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 });
  }
  if (body.byteLength > claims.maxBytes) {
    return NextResponse.json({ error: 'File exceeds the allowed size.' }, { status: 413 });
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    }),
  );

  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Sign-in required.' }, { status: 401 });

  const key = (await params).key.join('/');
  // Generic reader serves non-PII exercise media only. Patient documents must
  // go through their permission-scoped download route — never this one.
  if (!key.startsWith('exercises/')) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
    if (!res.Body) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const bytes = await res.Body.transformToByteArray();
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': res.ContentType ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
}
