import { LanguagePref, UserRole } from '@prisma/client';
import { z } from 'zod';

/**
 * Staff role enum — patients are created by the Secretary intake flow
 * (Prompt 6), not by the Admin user CRUD.
 */
export const STAFF_ROLES = [
  UserRole.ADMIN,
  UserRole.SECRETARY,
  UserRole.DOCTOR,
  UserRole.THERAPIST,
] as const;

export const userCreateSchema = z.object({
  fullNameEn: z.string().min(2).max(120),
  fullNameAr: z.string().min(2).max(120),
  email: z.string().email().max(255),
  phone: z.string().regex(/^\+9627\d{8}$/, 'phoneJordan'),
  role: z.enum(STAFF_ROLES),
  languagePref: z.nativeEnum(LanguagePref).default(LanguagePref.AR),
  specialtyIds: z.array(z.string().min(1)).default([]),
  mustChangePassword: z.boolean().default(true),
});

export const userUpdateSchema = userCreateSchema.extend({
  id: z.string().min(1),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const userListFiltersSchema = z.object({
  search: z.string().optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  specialtyId: z.string().min(1).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export type UserListFilters = z.infer<typeof userListFiltersSchema>;
