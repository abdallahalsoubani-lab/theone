import { LanguagePref } from '@prisma/client';
import { z } from 'zod';

/**
 * Clinic settings editor schemas (Prompt 11 §4.5). One singleton row
 * (`id = "default"`) holds every clinic-wide configuration value.
 * The conflict engine reads `businessHours` on every appointment
 * creation; keep the shape stable.
 */

const HM_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const dayHoursSchema = z.object({
  open: z.string().regex(HM_REGEX),
  close: z.string().regex(HM_REGEX),
  closed: z.boolean(),
});

export const businessHoursSchema = z.object({
  sun: dayHoursSchema,
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
});

export const serviceTypeSchema = z.object({
  id: z.string().min(1),
  nameEn: z.string().min(1).max(120),
  nameAr: z.string().min(1).max(120),
  defaultDurationMinutes: z
    .number()
    .int()
    .min(5)
    .max(8 * 60),
  active: z.boolean().default(true),
});

export const clinicSettingsUpdateSchema = z.object({
  nameEn: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200),
  phone: z.string().min(5).max(40),
  addressEn: z.string().min(1).max(500),
  addressAr: z.string().min(1).max(500),
  defaultAppointmentDuration: z
    .number()
    .int()
    .min(5)
    .max(8 * 60),
  defaultReminderOffsetMinutes: z
    .number()
    .int()
    .min(5)
    .max(60 * 24),
  reminderWindowStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM'),
  reminderWindowEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM'),
  defaultLanguage: z.nativeEnum(LanguagePref),
  hijriDefault: z.boolean(),
  patientCanViewClinicalNotes: z.boolean(),
  businessHours: businessHoursSchema,
  serviceTypes: z.array(serviceTypeSchema).min(1, 'At least one service type is required'),
});

export type ClinicSettingsUpdateInput = z.input<typeof clinicSettingsUpdateSchema>;
export type ClinicSettingsUpdateParsed = z.infer<typeof clinicSettingsUpdateSchema>;
