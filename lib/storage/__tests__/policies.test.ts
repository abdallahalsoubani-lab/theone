import { describe, expect, it } from 'vitest';

import { buildObjectKey, getUploadPolicy, validateUploadInput } from '../policies';

describe('validateUploadInput', () => {
  it('accepts a valid JPEG within size limits', () => {
    expect(
      validateUploadInput({
        kind: 'exercise_image',
        contentType: 'image/jpeg',
        sizeBytes: 100_000,
      }),
    ).toBeNull();
  });

  it('rejects an oversized image (> 5 MB)', () => {
    const err = validateUploadInput({
      kind: 'exercise_image',
      contentType: 'image/png',
      sizeBytes: 6 * 1024 * 1024,
    });
    expect(err?.code).toBe('TOO_LARGE');
  });

  it('rejects an unsupported image type (gif)', () => {
    const err = validateUploadInput({
      kind: 'exercise_image',
      contentType: 'image/gif',
      sizeBytes: 100_000,
    });
    expect(err?.code).toBe('UNSUPPORTED_TYPE');
  });

  it('accepts an MP4 within 50 MB', () => {
    expect(
      validateUploadInput({
        kind: 'exercise_video',
        contentType: 'video/mp4',
        sizeBytes: 30 * 1024 * 1024,
      }),
    ).toBeNull();
  });

  it('rejects MOV uploads — MP4/H.264 only in v1', () => {
    const err = validateUploadInput({
      kind: 'exercise_video',
      contentType: 'video/quicktime',
      sizeBytes: 10 * 1024 * 1024,
    });
    expect(err?.code).toBe('UNSUPPORTED_TYPE');
  });

  it('rejects a 51 MB video', () => {
    const err = validateUploadInput({
      kind: 'exercise_video',
      contentType: 'video/mp4',
      sizeBytes: 51 * 1024 * 1024,
    });
    expect(err?.code).toBe('TOO_LARGE');
  });

  it('rejects zero-byte uploads', () => {
    expect(
      validateUploadInput({
        kind: 'exercise_image',
        contentType: 'image/jpeg',
        sizeBytes: 0,
      })?.code,
    ).toBe('TOO_LARGE');
  });
});

describe('buildObjectKey', () => {
  it('builds an exercise-image key with the right prefix + date + extension', () => {
    const key = buildObjectKey({
      kind: 'exercise_image',
      userId: 'user-abc',
      contentType: 'image/jpeg',
      now: new Date('2026-05-20T10:30:00Z'),
    });
    expect(key).toMatch(/^exercises\/img\/user-abc\/20260520\/[a-z0-9]+\.jpg$/);
  });

  it('builds an exercise-video key with mp4 extension', () => {
    const key = buildObjectKey({
      kind: 'exercise_video',
      userId: 'user-abc',
      contentType: 'video/mp4',
      now: new Date('2026-05-20T10:30:00Z'),
    });
    expect(key).toMatch(/^exercises\/video\/user-abc\/20260520\/[a-z0-9]+\.mp4$/);
  });

  it('falls back to .bin for unknown content types (defensive — validator catches first)', () => {
    const key = buildObjectKey({
      kind: 'exercise_image',
      userId: 'user-x',
      contentType: 'application/octet-stream',
      now: new Date('2026-05-20T10:30:00Z'),
    });
    expect(key.endsWith('.bin')).toBe(true);
  });
});

describe('getUploadPolicy', () => {
  it('returns distinct prefixes for image vs video kinds', () => {
    expect(getUploadPolicy('exercise_image').keyPrefix).toBe('exercises/img');
    expect(getUploadPolicy('exercise_video').keyPrefix).toBe('exercises/video');
  });
});
