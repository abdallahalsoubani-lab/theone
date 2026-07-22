import { describe, expect, it } from 'vitest';

import { exerciseCreateSchema, exerciseUpdateSchema } from '../schemas';

/**
 * D-8 / D-1r regression (Prompt 32): since the proxy-storage rework,
 * buildPublicUrl returns a RELATIVE `/api/v1/storage/...` path. The old
 * `z.string().url()` rejected it, so every exercise save WITH media failed
 * validation while media-less saves worked — "exercise is not added when
 * media is attached".
 */

const base = {
  nameEn: 'Wall squat',
  nameAr: 'تمرين القرفصاء',
  category: 'STRENGTH',
  anatomicalRegion: 'SHOULDER',
  descriptionEn: 'Stand against a wall and squat slowly.',
  descriptionAr: 'قف مستنداً إلى الحائط ثم انزل ببطء.',
};

describe('exercise media URLs (D-8 root cause)', () => {
  it('regression: creating without media still validates', () => {
    expect(exerciseCreateSchema.safeParse(base).success).toBe(true);
  });

  it('accepts the same-origin proxy path the uploader actually produces', () => {
    const r = exerciseCreateSchema.safeParse({
      ...base,
      imageUrl: '/api/v1/storage/exercises/img/u1/20260722/abc123.jpg',
      imageMimeType: 'image/jpeg',
      imageSizeBytes: 123_456,
      videoUrl: '/api/v1/storage/exercises/video/u1/20260722/def456.mp4',
      videoMimeType: 'video/mp4',
      videoSizeBytes: 12_345_678,
    });
    expect(r.success).toBe(true);
  });

  it('still accepts absolute http(s) URLs (legacy presigned-era rows)', () => {
    expect(
      exerciseCreateSchema.safeParse({
        ...base,
        imageUrl: 'https://cdn.example.com/exercises/img/abc.jpg',
      }).success,
    ).toBe(true);
  });

  it('rejects non-storage strings (javascript:, arbitrary text, protocol-relative)', () => {
    for (const bad of ['javascript:alert(1)', 'not a url', '//evil.example.com/x.jpg']) {
      expect(exerciseCreateSchema.safeParse({ ...base, imageUrl: bad }).success).toBe(false);
    }
  });

  it('update schema applies the same rule', () => {
    expect(
      exerciseUpdateSchema.safeParse({
        ...base,
        id: 'ex-1',
        videoUrl: '/api/v1/storage/exercises/video/u1/20260722/xyz.mov',
      }).success,
    ).toBe(true);
  });
});
