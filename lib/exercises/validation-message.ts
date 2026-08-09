import type { z } from 'zod';

/**
 * Turn a Zod rejection into a message that names the field — in BOTH
 * languages (PT-B5 item 1).
 *
 * The actions used to return the first issue's English text and a single flat
 * Arabic sentence ("بيانات التمرين غير صالحة"), so an Arabic-speaking user —
 * which is everyone at this clinic — could not tell a rejected media URL from
 * a too-short description. That is the "generic failure" the QA round hit
 * while trying to attach an image: the save failed and the message said
 * nothing about which field, or that media was involved at all.
 *
 * Pure so it unit-tests without the action layer.
 */

const FIELD_LABELS: Record<string, { en: string; ar: string }> = {
  nameEn: { en: 'Name (English)', ar: 'الاسم (إنجليزي)' },
  nameAr: { en: 'Name (Arabic)', ar: 'الاسم (عربي)' },
  category: { en: 'Category', ar: 'التصنيف' },
  anatomicalRegion: { en: 'Anatomical region', ar: 'المنطقة التشريحية' },
  descriptionEn: { en: 'Description (English)', ar: 'الوصف (إنجليزي)' },
  descriptionAr: { en: 'Description (Arabic)', ar: 'الوصف (عربي)' },
  contraindications: { en: 'Contraindications', ar: 'موانع الاستعمال' },
  defaultInstructionEn: { en: 'Instruction (English)', ar: 'التعليمات (إنجليزي)' },
  defaultInstructionAr: { en: 'Instruction (Arabic)', ar: 'التعليمات (عربي)' },
  imageUrl: { en: 'Image', ar: 'الصورة' },
  imageMimeType: { en: 'Image', ar: 'الصورة' },
  imageSizeBytes: { en: 'Image', ar: 'الصورة' },
  videoUrl: { en: 'Video', ar: 'الفيديو' },
  videoMimeType: { en: 'Video', ar: 'الفيديو' },
  videoSizeBytes: { en: 'Video', ar: 'الفيديو' },
};

/** True when the rejected field is one of the media fields. */
export function isMediaField(field: string | undefined): boolean {
  return field !== undefined && (field.startsWith('image') || field.startsWith('video'));
}

export interface ExerciseValidationMessage {
  code: 'VALIDATION' | 'VALIDATION_MEDIA';
  message_en: string;
  message_ar: string;
  /** The offending field, so the form can point at it. */
  field?: string;
}

/**
 * A media rejection gets its own code and a message that says the attachment
 * is the problem — the one thing a user staring at a failed save needs to
 * know, and the signal that separates "the file didn't upload" from "the
 * exercise didn't save".
 */
export function exerciseValidationMessage(error: z.ZodError): ExerciseValidationMessage {
  const issue = error.issues[0];
  const field = issue?.path[0];
  const key = typeof field === 'string' ? field : undefined;
  const label = key ? FIELD_LABELS[key] : undefined;
  const detail = issue?.message ?? 'Invalid value.';

  if (isMediaField(key)) {
    return {
      code: 'VALIDATION_MEDIA',
      message_en: `The attached ${label?.en.toLowerCase() ?? 'file'} was rejected (${detail}). Remove it and upload again.`,
      message_ar: `تم رفض ${label?.ar ?? 'الملف'} المرفقة. احذفها وأعد الرفع.`,
      field: key,
    };
  }

  if (label) {
    return {
      code: 'VALIDATION',
      message_en: `${label.en}: ${detail}`,
      message_ar: `${label.ar}: بيانات غير صالحة.`,
      field: key,
    };
  }

  return {
    code: 'VALIDATION',
    message_en: detail,
    message_ar: 'بيانات التمرين غير صالحة.',
    ...(key ? { field: key } : {}),
  };
}
