import { z } from 'zod';

export const specialtyCreateSchema = z.object({
  nameEn: z.string().min(2).max(100),
  nameAr: z.string().min(2).max(100),
  description: z.string().max(500).optional().nullable(),
  active: z.boolean().default(true),
});

export const specialtyUpdateSchema = specialtyCreateSchema.extend({
  id: z.string().min(1),
});

export type SpecialtyCreateInput = z.infer<typeof specialtyCreateSchema>;
export type SpecialtyUpdateInput = z.infer<typeof specialtyUpdateSchema>;

export const specialtyListFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export type SpecialtyListFilters = z.infer<typeof specialtyListFiltersSchema>;
