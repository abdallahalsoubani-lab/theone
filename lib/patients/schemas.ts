import { Gender, LanguagePref } from '@prisma/client';
import { z } from 'zod';

/**
 * Patient registration schema (Prompt 6 §4.1).
 *
 * Mirrors the existing intake-form basic profile fields. Phone uses the
 * project-wide Jordan E.164 regex; uniqueness on non-deleted patients is
 * enforced by the partial unique index from Prompt 2 plus an explicit
 * pre-check in `services.ts` for friendlier error messages.
 */
export const patientCreateSchema = z.object({
  fullNameEn: z.string().min(3).max(120),
  // Arabic name is optional (July change request #10). Stored as '' when
  // omitted; the UI falls back to the English name via patientDisplayName().
  // Kept as a plain string (not nullable) so the shared User.fullNameAr column
  // stays NOT NULL and staff/patient name reads don't become `string | null`.
  fullNameAr: z.string().max(120).optional().default(''),
  phone: z.string().regex(/^\+9627\d{8}$/, 'phoneJordan'),
  email: z
    .string()
    .email()
    .max(255)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v.toLowerCase() : null))
    .nullable(),
  dateOfBirth: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now(), { message: 'required' })
    .refine((d) => d.getTime() >= new Date('1900-01-01').getTime(), {
      message: 'required',
    }),
  gender: z.nativeEnum(Gender),
  nationalId: z.string().max(40).optional().or(z.literal('')).nullable(),
  // Address is optional (July change request #10); stored as null when omitted
  // (the PatientProfile.address column is already nullable).
  address: z.string().max(500).optional().default(''),
  occupation: z.string().max(120).optional().or(z.literal('')).nullable(),
  emergencyContactName: z.string().max(120).optional().or(z.literal('')).nullable(),
  emergencyContactPhone: z
    .string()
    .regex(/^\+9627\d{8}$/, 'phoneJordan')
    .optional()
    .or(z.literal(''))
    .nullable(),
  languagePref: z.nativeEnum(LanguagePref).default(LanguagePref.AR),
  hijriCalendarPref: z.boolean().default(false),
  medicalHistorySummary: z.string().max(2000).optional().or(z.literal('')).nullable(),
  allergies: z.string().max(1000).optional().or(z.literal('')).nullable(),
  currentMedications: z.string().max(1000).optional().or(z.literal('')).nullable(),
  // Initial care team (Prompt 14). Any number of therapists + doctors chosen
  // on the create form; role validity is enforced in lib/patients/assignment.ts
  // (it requires a DB lookup). On edit the care team is managed by the live
  // care-team card, not this schema.
  therapistIds: z.array(z.string()).optional(),
  doctorIds: z.array(z.string()).optional(),
});

export const patientUpdateSchema = patientCreateSchema.extend({
  id: z.string().min(1),
});

/**
 * Patient self-edit (Prompt 6 §4.7). Narrow subset — name, DOB, gender,
 * national ID, clinical fields, phone all stay read-only. The action layer
 * re-enforces this regardless of what the form posts.
 */
export const patientSelfEditSchema = z.object({
  email: z
    .string()
    .email()
    .max(255)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v.toLowerCase() : null))
    .nullable(),
  // Optional (July change request #10) — matches the create form.
  address: z.string().max(500).optional().default(''),
  emergencyContactName: z.string().max(120).optional().or(z.literal('')).nullable(),
  emergencyContactPhone: z
    .string()
    .regex(/^\+9627\d{8}$/, 'phoneJordan')
    .optional()
    .or(z.literal(''))
    .nullable(),
  languagePref: z.nativeEnum(LanguagePref),
  hijriCalendarPref: z.boolean(),
});

export type PatientCreateInput = z.infer<typeof patientCreateSchema>;
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;
export type PatientSelfEditInput = z.infer<typeof patientSelfEditSchema>;

export const patientListFiltersSchema = z.object({
  search: z.string().optional(),
  intakeStatus: z.enum(['all', 'pending', 'completed', 'multiple']).default('all'),
  assignment: z.enum(['all', 'assigned', 'unassigned']).default('all'),
  ageGroup: z.enum(['all', 'adult', 'pediatric']).default('all'),
  language: z.nativeEnum(LanguagePref).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export type PatientListFilters = z.infer<typeof patientListFiltersSchema>;

const PEDIATRIC_AGE_CUTOFF_YEARS = 14;

export function computeAgeYears(dateOfBirth: Date, now: Date = new Date()): number {
  const ms = now.getTime() - dateOfBirth.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

export function isPediatric(dateOfBirth: Date): boolean {
  return computeAgeYears(dateOfBirth) < PEDIATRIC_AGE_CUTOFF_YEARS;
}
