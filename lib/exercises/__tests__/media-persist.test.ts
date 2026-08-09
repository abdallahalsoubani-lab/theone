import { describe, expect, it } from 'vitest';

import { exerciseCreateSchema, exerciseUpdateSchema } from '../schemas';
import { exerciseValidationMessage, isMediaField } from '../validation-message';

/**
 * PT-B5 item 1 — "adding an exercise WITH an image or video fails, without
 * media it works."
 *
 * The historical cause was a `z.string().url()` on the media fields, which
 * rejects the same-origin proxy path the uploader produces
 * (`/api/v1/storage/...`). That is fixed; this suite proves the whole
 * media-bearing payload — url AND the mime/size metadata that travels with
 * it — survives validation on both create and update, so a failure on a
 * deployed VM is an environment problem (see
 * docs/storage/upload-troubleshooting.md), not this code.
 */

const base = {
  nameEn: 'Wall pushup',
  nameAr: 'تمرين الضغط على الحائط',
  category: 'STRENGTH',
  anatomicalRegion: 'SHOULDER',
  descriptionEn: 'Stand facing a wall and push gently.',
  descriptionAr: 'قف مواجهاً الحائط وادفع بلطف.',
};

const image = {
  imageUrl: '/api/v1/storage/exercises/abc/photo.jpg',
  imageMimeType: 'image/jpeg',
  imageSizeBytes: 2_400_000,
};

const video = {
  videoUrl: '/api/v1/storage/exercises/abc/clip.mp4',
  videoMimeType: 'video/mp4',
  videoSizeBytes: 64_000_000,
};

describe('an exercise carrying media validates', () => {
  it('accepts an image with its mime type and size', () => {
    const parsed = exerciseCreateSchema.parse({ ...base, ...image });
    expect(parsed.imageUrl).toBe(image.imageUrl);
    expect(parsed.imageMimeType).toBe('image/jpeg');
    expect(parsed.imageSizeBytes).toBe(2_400_000);
  });

  it('accepts an mp4 video near the 100 MB ceiling', () => {
    const parsed = exerciseCreateSchema.parse({ ...base, ...video });
    expect(parsed.videoUrl).toBe(video.videoUrl);
    expect(parsed.videoMimeType).toBe('video/mp4');
  });

  it('accepts both at once', () => {
    expect(exerciseCreateSchema.safeParse({ ...base, ...image, ...video }).success).toBe(true);
  });

  it('accepts media on the update (new-version) path too', () => {
    expect(
      exerciseUpdateSchema.safeParse({ id: 'ex-1', ...base, ...image, ...video }).success,
    ).toBe(true);
  });

  it('still accepts an exercise with no media at all', () => {
    expect(exerciseCreateSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a media URL that is not ours — an off-site link is not an upload', () => {
    const r = exerciseCreateSchema.safeParse({ ...base, imageUrl: 'javascript:alert(1)' });
    expect(r.success).toBe(false);
  });
});

describe('a rejected save says WHAT was rejected, in both languages', () => {
  it('names the attachment when the media field is the problem', () => {
    const r = exerciseCreateSchema.safeParse({ ...base, imageUrl: 'not-a-storage-url' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = exerciseValidationMessage(r.error);
    expect(msg.code).toBe('VALIDATION_MEDIA');
    expect(msg.field).toBe('imageUrl');
    // The Arabic message used to be one flat sentence for every failure —
    // an Arabic-speaking user could not tell a bad attachment from a short
    // description. It must now mention the attachment.
    expect(msg.message_ar).toContain('الصورة');
    expect(msg.message_en.toLowerCase()).toContain('image');
  });

  it('names a normal field when that is the problem, still in both languages', () => {
    const r = exerciseCreateSchema.safeParse({ ...base, descriptionAr: 'قصير' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = exerciseValidationMessage(r.error);
    expect(msg.code).toBe('VALIDATION');
    expect(msg.field).toBe('descriptionAr');
    expect(msg.message_ar).toContain('الوصف');
    expect(msg.message_ar).not.toBe('بيانات التمرين غير صالحة.');
  });

  it('classifies every media field as media, and nothing else', () => {
    for (const f of ['imageUrl', 'imageMimeType', 'imageSizeBytes', 'videoUrl', 'videoSizeBytes']) {
      expect(isMediaField(f)).toBe(true);
    }
    for (const f of ['nameEn', 'descriptionAr', 'category', undefined]) {
      expect(isMediaField(f)).toBe(false);
    }
  });
});
