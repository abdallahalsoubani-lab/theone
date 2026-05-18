import { z } from 'zod';

import { isValidCategory, isValidRegion } from './taxonomy';

const optionalText = z.string().max(5000).optional().nullable();

export const exerciseCreateSchema = z.object({
  nameEn: z.string().min(3).max(200),
  nameAr: z.string().min(3).max(200),
  category: z.string().refine(isValidCategory, 'Invalid category.'),
  anatomicalRegion: z.string().refine(isValidRegion, 'Invalid anatomical region.'),
  descriptionEn: z.string().min(10).max(5000),
  descriptionAr: z.string().min(10).max(5000),
  contraindications: optionalText,
  defaultInstructionEn: optionalText,
  defaultInstructionAr: optionalText,
  videoUrl: z.string().url().optional().nullable(),
  videoMimeType: z.string().optional().nullable(),
  videoSizeBytes: z.number().int().min(0).optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  imageMimeType: z.string().optional().nullable(),
  imageSizeBytes: z.number().int().min(0).optional().nullable(),
});

export const exerciseUpdateSchema = exerciseCreateSchema.extend({
  id: z.string().min(1),
});

export const exerciseListFiltersSchema = z.object({
  search: z.string().max(200).optional(),
  category: z.string().optional(),
  anatomicalRegion: z.string().optional(),
  showArchived: z.boolean().default(false),
  hasVideo: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type ExerciseCreateInput = z.infer<typeof exerciseCreateSchema>;
export type ExerciseUpdateInput = z.infer<typeof exerciseUpdateSchema>;
export type ExerciseListFilters = z.infer<typeof exerciseListFiltersSchema>;
