import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration: the real s3 client against the local MinIO from `pnpm infra:up`
 * (Prompt 32 §4 — image, video, and document bytes stored + retrievable).
 *
 * CI has no MinIO service container, so the suite SKIPS itself when nothing
 * answers on the endpoint — it runs meaningfully on dev machines with the
 * infra up, and never turns CI red for environmental reasons. The route-level
 * behaviour (token gate, 413/503/502) is pinned by the mocked route tests.
 */

const ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';

let reachable = false;
beforeAll(async () => {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    // MinIO answers /minio/health/live with 200 without auth.
    const res = await fetch(`${ENDPOINT}/minio/health/live`, { signal: ctl.signal });
    clearTimeout(timer);
    reachable = res.ok;
  } catch {
    reachable = false;
  }
});

const CASES = [
  { label: 'image', key: 'exercises/img/test/itest.jpg', type: 'image/jpeg' },
  { label: 'video', key: 'exercises/video/test/itest.mp4', type: 'video/mp4' },
  { label: 'document', key: 'patients/test/documents/itest.pdf', type: 'application/pdf' },
] as const;

describe('MinIO round-trip (skips when local MinIO is down)', () => {
  it.each(CASES)('stores and retrieves a $label object', async ({ key, type }) => {
    if (!reachable) return; // environment-gated skip

    const { s3, STORAGE_BUCKET } = await import('../client');
    const bytes = new TextEncoder().encode(`integration-${key}`);
    await s3.send(
      new PutObjectCommand({ Bucket: STORAGE_BUCKET, Key: key, Body: bytes, ContentType: type }),
    );
    const got = await s3.send(new GetObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
    const roundTripped = await got.Body!.transformToByteArray();
    expect(Buffer.from(roundTripped).toString()).toBe(`integration-${key}`);
    expect(got.ContentType).toBe(type);
    await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
  });

  it('reports whether this run actually exercised MinIO', () => {
    // Not an assertion — a visible line in the run log so "all green" can't be
    // mistaken for "integration ran" when the infra was down.
    console.warn(`[minio-integration] endpoint ${ENDPOINT} reachable: ${reachable}`);
    expect(true).toBe(true);
  });
});
