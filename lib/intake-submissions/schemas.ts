import { Gender } from '@prisma/client';
import { z } from 'zod';

import { adultIntakeSchema, pediatricIntakeSchema } from '@/lib/intake/schemas';

/**
 * Public self-service intake (Prompt 23). The patient fills the identifying
 * fields (Section A profile) AND the existing Adult/Child intake questions on
 * one unauthenticated form. The answers reuse the EXACT secretary schemas
 * (`adultIntakeSchema` / `pediatricIntakeSchema`); this file only adds the
 * profile section, the honeypot, and the locale marker.
 */

/**
 * Identifying fields needed to create the patient on approval. One name field
 * (copied into both fullNameEn/fullNameAr at approval). Phone is accepted
 * loosely here and normalised + validated server-side against the Jordan E.164
 * rule. `min(3)` on the name matches `patientCreateSchema` so approval never
 * fails on length.
 */
export const publicProfileSchema = z.object({
  fullName: z.string().trim().min(3).max(120),
  phone: z.string().trim().min(6).max(25),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'required'),
  gender: z.nativeEnum(Gender),
  address: z.string().trim().min(5).max(500),
  email: z.string().email().max(255).optional().or(z.literal('')),
});
export type PublicProfileInput = z.infer<typeof publicProfileSchema>;

/** Honeypot — a real human leaves it empty; bots fill every field. */
const honeypot = z.string().max(0).optional().or(z.literal(''));

const localeField = z.enum(['en', 'ar']).default('ar');

export const publicAdultSubmissionSchema = z.object({
  type: z.literal('ADULT'),
  locale: localeField,
  profile: publicProfileSchema,
  answers: adultIntakeSchema,
  website: honeypot,
});

export const publicPediatricSubmissionSchema = z.object({
  type: z.literal('PEDIATRIC'),
  locale: localeField,
  profile: publicProfileSchema,
  answers: pediatricIntakeSchema,
  website: honeypot,
});

/** Server-side re-validation of whatever the public form posted. */
export const publicSubmissionSchema = z.discriminatedUnion('type', [
  publicAdultSubmissionSchema,
  publicPediatricSubmissionSchema,
]);
export type PublicSubmissionInput = z.infer<typeof publicSubmissionSchema>;

export const rejectSubmissionSchema = z.object({
  submissionId: z.string().min(1),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});

export const approveNewSchema = z.object({ submissionId: z.string().min(1) });
export const approveLinkSchema = z.object({
  submissionId: z.string().min(1),
  patientId: z.string().min(1),
});
