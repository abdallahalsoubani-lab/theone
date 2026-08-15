import { Gender, LanguagePref } from '@prisma/client';
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
 * Identifying fields needed to create the patient on approval (QA 13/7
 * items 5.2 + 5.3). Two name fields, both collected regardless of the form
 * locale: the Arabic name is required (it feeds `submittedName` and
 * `User.fullNameAr`); the English name is optional because the submission
 * stores the profile as Json (no non-null column) — on approval a missing EN
 * name falls back to the AR name so `User.fullNameEn` is never empty. When
 * the EN name IS provided it must satisfy the same `min(3).max(120)` bounds
 * as `patientCreateSchema` so approval never fails on length. Phone is
 * accepted loosely here and normalised + validated server-side against the
 * Jordan E.164 rule. `languagePref` is the patient's EXPLICIT channel/portal
 * language choice (defaulted to the form locale by the UI); it is optional
 * here so pre-fix clients stay valid — the service falls back to the form
 * locale.
 */
export const publicProfileSchema = z.object({
  fullNameAr: z.string().trim().min(3).max(120),
  fullNameEn: z.string().trim().min(3).max(120).optional().or(z.literal('')),
  phone: z.string().trim().min(6).max(25),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'required')
    // Same bounds as patientCreateSchema (Prompt 46 item A): no future
    // dates, 1900 floor. String-compare works on zero-padded ISO.
    .refine((v) => v <= new Date().toISOString().slice(0, 10), { message: 'dobFuture' })
    .refine((v) => v >= '1900-01-01', { message: 'dobTooEarly' }),
  gender: z.nativeEnum(Gender),
  languagePref: z.nativeEnum(LanguagePref).optional(),
  // Optional (PT-B4 item 2), matching patientCreateSchema — a patient filling
  // this on a phone should not be stopped by an address the clinic can take
  // at the desk. Stored as null when omitted (PatientProfile.address is
  // nullable) and every display site already falls back to a dash.
  address: z.string().trim().max(500).optional().default(''),
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
