import { z } from 'zod';

export const roomCreateSchema = z.object({
  name: z.string().min(2).max(80),
  active: z.boolean().default(true),
});

export const roomUpdateSchema = roomCreateSchema.extend({
  id: z.string().cuid(),
});

export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type RoomUpdateInput = z.infer<typeof roomUpdateSchema>;

export const roomListFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export type RoomListFilters = z.infer<typeof roomListFiltersSchema>;
