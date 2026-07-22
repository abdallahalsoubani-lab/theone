import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock, s3Send, verifyMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  s3Send: vi.fn(),
  verifyMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: (...a: unknown[]) => authMock(...a) }));
vi.mock('@/lib/storage/client', () => ({
  s3: { send: (...a: unknown[]) => s3Send(...a) },
  STORAGE_BUCKET: 'theone-uploads',
}));
vi.mock('@/lib/storage/uploadToken', () => ({
  verifyUploadToken: (...a: unknown[]) => verifyMock(...a),
}));

import { GET, PUT } from '../[...key]/route';

const KEY = ['exercises', 'img.jpg'];
const GRANT = { key: 'exercises/img.jpg', contentType: 'image/jpeg', maxBytes: 5 * 1024 * 1024 };

function putRequest(opts: { token?: string; contentType?: string; body?: Uint8Array }) {
  const url = `http://localhost/api/v1/storage/exercises/img.jpg${opts.token ? `?t=${opts.token}` : ''}`;
  const bytes = opts.body ?? new Uint8Array([1, 2, 3]);
  return new NextRequest(url, {
    method: 'PUT',
    headers: opts.contentType ? { 'content-type': opts.contentType } : {},
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
}

const params = (key = KEY) => ({ params: Promise.resolve({ key }) });

beforeEach(() => {
  vi.clearAllMocks();
  verifyMock.mockResolvedValue(GRANT);
  s3Send.mockResolvedValue({});
});

describe('storage proxy PUT (QA 2.3)', () => {
  it('rejects a missing token with 401', async () => {
    const res = await PUT(putRequest({ contentType: 'image/jpeg' }), params());
    expect(res.status).toBe(401);
  });

  it('rejects an invalid/expired token with 403', async () => {
    verifyMock.mockResolvedValue(null);
    const res = await PUT(putRequest({ token: 'bad', contentType: 'image/jpeg' }), params());
    expect(res.status).toBe(403);
  });

  it('rejects a token scoped to a different key with 403', async () => {
    verifyMock.mockResolvedValue({ ...GRANT, key: 'exercises/other.jpg' });
    const res = await PUT(putRequest({ token: 't', contentType: 'image/jpeg' }), params());
    expect(res.status).toBe(403);
  });

  it('accepts case/parameter variations of the granted content type (QA retest #5)', async () => {
    const res = await PUT(
      putRequest({ token: 't', contentType: 'IMAGE/JPEG; charset=binary' }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(s3Send).toHaveBeenCalledTimes(1);
  });

  it('rejects an oversized body with 413', async () => {
    verifyMock.mockResolvedValue({ ...GRANT, maxBytes: 2 });
    const res = await PUT(putRequest({ token: 't', contentType: 'image/jpeg' }), params());
    expect(res.status).toBe(413);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('rejects an empty body with 400', async () => {
    const res = await PUT(
      putRequest({ token: 't', contentType: 'image/jpeg', body: new Uint8Array(0) }),
      params(),
    );
    expect(res.status).toBe(400);
  });

  it('answers 503 STORAGE_UNAVAILABLE when the store is unreachable (Prompt 32 — R-14/41)', async () => {
    // What the rebuilt VM produced while the MinIO service was missing.
    s3Send.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9000'));
    const res = await PUT(putRequest({ token: 't', contentType: 'image/jpeg' }), params());
    expect(res.status).toBe(503);
    expect((await res.json()) as object).toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('surfaces non-connection object-store failures as 502 (misconfigured backend, not a code bug)', async () => {
    s3Send.mockRejectedValue(new Error('The specified bucket does not exist'));
    const res = await PUT(putRequest({ token: 't', contentType: 'image/jpeg' }), params());
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('object-store');
  });
});

describe('storage proxy GET', () => {
  it('requires a session (401 unauthenticated)', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(new NextRequest('http://localhost/x'), params());
    expect(res.status).toBe(401);
  });

  it('never serves patient documents through the generic reader (PII guard)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await GET(new NextRequest('http://localhost/x'), params(['documents', 'p1.pdf']));
    expect(res.status).toBe(404);
    expect(s3Send).not.toHaveBeenCalled();
  });
});
