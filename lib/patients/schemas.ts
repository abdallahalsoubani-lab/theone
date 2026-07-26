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
/** Cross-field P50 name rule, applied to both create and update below. */
const atLeastOneName = {
  check: (v: { fullNameEn: string; fullNameAr: string }) =>
    v.fullNameEn.length > 0 || v.fullNameAr.length > 0,
  params: { message: 'nameRequired', path: ['fullNameAr'] as (string | number)[] },
};

const patientBaseSchema = z.object({
  // P50 name rule: at least ONE of the two names is required — either alone
  // is valid (the real clinic's records are Arabic-only). Both stored as ''
  // when omitted so the NOT NULL columns and non-nullable reads stay intact.
  // The cross-field check is the .refine() on the exported schemas.
  fullNameEn: z
    .string()
    .max(120)
    .optional()
    .default('')
    .transform((v) => v.trim()),
  fullNameAr: z
    .string()
    .max(120)
    .optional()
    .default('')
    .transform((v) => v.trim()),
  // P50: phone optional (imported records with broken numbers have none) and
  // NOT unique for patients (families share one number). '' → null.
  phone: z
    .string()
    .regex(/^\+9627\d{8}$/, 'phoneJordan')
    .optional()
    .or(z.literal(''))
    .transform((v) => v || null)
    .nullable(),
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

export const patientCreateSchema = patientBaseSchema.refine(
  atLeastOneName.check,
  atLeastOneName.params,
);

export const patientUpdateSchema = patientBaseSchema
  .extend({
    id: z.string().min(1),
  })
  .refine(atLeastOneName.check, atLeastOneName.params);

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

/**
 * P52 sentinel (owner-signed): one imported adult has an unknown DOB stored
 * as 1900-01-01 (the column is NOT NULL; the clinic completes it from the
 * paper file). Any DOB in year 1900 or earlier means "unknown" — age and
 * date displays MUST render '—', never "126y".
 */
export function isUnknownDob(dateOfBirth: Date): boolean {
  return dateOfBirth.getUTCFullYear() <= 1900;
}

export function computeAgeYears(dateOfBirth: Date, now: Date = new Date()): number {
  const ms = now.getTime() - dateOfBirth.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

/** Display-safe age: null for the unknown-DOB sentinel (render '—'). */
export function displayAgeYears(dateOfBirth: Date, now: Date = new Date()): number | null {
  return isUnknownDob(dateOfBirth) ? null : computeAgeYears(dateOfBirth, now);
}

export function isPediatric(dateOfBirth: Date): boolean {
  return computeAgeYears(dateOfBirth) < PEDIATRIC_AGE_CUTOFF_YEARS;
}
