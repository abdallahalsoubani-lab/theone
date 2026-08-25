import type { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import { clinicDateKey, clinicHm, clinicWeekdayName } from '@/lib/time/clinic';
import { getClinicTimeZone } from '@/lib/time/clinic-server';

/**
 * Registry-driven template variables (Prompt 48b §3.5).
 *
 * Every appointment-template send builds its `{{1}}…{{n}}` array from the
 * template ROW's `variablesShape` (an ordered token list stored in the DB),
 * falling back to the LEGACY hardcoded order when the row has none. That
 * makes the v2 switch a pure Admin operation: paste the new SID + set the
 * new shape on the same row — zero deploy.
 *
 * v2 target shape (all four appointment templates, owner decision):
 *   ["patientName", "dayName", "date", "time"]
 * where dayName is the localized weekday in clinic wall time.
 */

export type TemplateVarToken =
  | 'patientName'
  | 'therapistName'
  | 'date'
  | 'time'
  | 'dayName'
  | 'reason'
  | 'intakeUrl';

export interface TemplateVarContext {
  patientName: string;
  therapistName: string;
  /** Clinic-wall date key (YYYY-MM-DD). */
  date: string;
  /** Clinic-wall HH:mm. */
  time: string;
  /** Localized weekday name in clinic wall time. */
  dayName: string;
  /** Cancellation reason — only meaningful for the cancelled template. */
  reason?: string;
  /** P52 — the personal intake link; only set for the new-patient template. */
  intakeUrl?: string;
}

/** Pre-48b hardcoded orders — the exact arrays the call sites used to build. */
export const LEGACY_SHAPES: Record<string, TemplateVarToken[]> = {
  appointment_confirmation_v2: ['patientName', 'therapistName', 'date', 'time'],
  // P45 3-variable reminder: {{1}} clinician, {{2}} time, {{3}} day/date.
  appointment_reminder_v2: ['therapistName', 'time', 'date'],
  // P48 4-variable rescheduled: {{1}} patient, {{2}} date, {{3}} time, {{4}} clinician.
  appointment_rescheduled: ['patientName', 'date', 'time', 'therapistName'],
  appointment_cancelled_v2: ['date', 'time', 'reason'],
  // July 31 item 3: {{1}} = patient first name, nothing else.
  arrival_confirmation: ['patientName'],
  // P52 combined new-patient confirmation: {{1}} patient, {{2}} date,
  // {{3}} time, {{4}} personal intake link.
  new_patient_confirmation: ['patientName', 'date', 'time', 'intakeUrl'],
};

function isTokenArray(v: unknown): v is TemplateVarToken[] {
  return (
    Array.isArray(v) &&
    v.every(
      (t) =>
        typeof t === 'string' &&
        ['patientName', 'therapistName', 'date', 'time', 'dayName', 'reason', 'intakeUrl'].includes(
          t,
        ),
    )
  );
}

/** Parse a stored variablesShape column value; null/malformed → null. */
export function parseVariablesShape(raw: Prisma.JsonValue | null): TemplateVarToken[] | null {
  return isTokenArray(raw) ? raw : null;
}

/** Build the ordered parameter array for a shape from the context. */
export function buildParamsFromShape(shape: TemplateVarToken[], ctx: TemplateVarContext): string[] {
  return shape.map((token) => ctx[token] ?? '');
}

/**
 * Resolve the effective shape for (template, language): the row's stored
 * shape when present, else the legacy default. A template outside the
 * legacy map with no stored shape returns null — the caller should treat
 * that as a hard configuration error, not guess.
 */
export async function resolveTemplateShape(
  templateName: string,
  language: 'AR' | 'EN',
): Promise<TemplateVarToken[] | null> {
  const row = await db.whatsAppTemplate.findUnique({
    where: { name_language: { name: templateName, language } },
    select: { variablesShape: true },
  });
  return parseVariablesShape(row?.variablesShape ?? null) ?? LEGACY_SHAPES[templateName] ?? null;
}

/**
 * Convenience: the full clinic-wall context for an appointment instant in
 * the recipient's language.
 */
export async function appointmentVarContext(args: {
  startsAt: Date;
  patientName: string;
  therapistName: string;
  language: 'AR' | 'EN';
  reason?: string;
  intakeUrl?: string;
}): Promise<TemplateVarContext> {
  const tz = await getClinicTimeZone();
  const locale = args.language === 'AR' ? 'ar' : 'en';
  return {
    patientName: args.patientName,
    therapistName: args.therapistName,
    date: clinicDateKey(args.startsAt, tz),
    time: clinicHm(args.startsAt, tz),
    dayName: clinicWeekdayName(args.startsAt, locale, tz),
    reason: args.reason,
    intakeUrl: args.intakeUrl,
  };
}
