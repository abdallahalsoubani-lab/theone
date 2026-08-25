import 'server-only';

import type { IntakeType } from '@prisma/client';

import { db } from '@/lib/db';

/** The link plus the identity fields the tokenized page prefills (read-only). */
export interface ResolvedIntakeLink {
  id: string;
  patientId: string;
  formType: IntakeType;
  usedAt: Date | null;
  patientFullNameEn: string;
  patientFullNameAr: string;
  patientPhone: string | null;
  patientLanguagePref: 'AR' | 'EN';
}

/**
 * Resolve a token to its link + patient identity. Returns null for an
 * unknown token — the caller shows the SAME neutral message for unknown,
 * used, and malformed tokens, never revealing whether a token existed.
 * (Used-vs-fresh is distinguished by usedAt for the page's own branching,
 * but both render the neutral screen.)
 */
export async function resolveIntakeLink(token: string): Promise<ResolvedIntakeLink | null> {
  if (!token || token.length < 20) return null;
  const link = await db.patientIntakeLink.findUnique({
    where: { token },
    select: {
      id: true,
      patientId: true,
      formType: true,
      usedAt: true,
      patient: {
        select: { fullNameEn: true, fullNameAr: true, phone: true, languagePref: true },
      },
    },
  });
  if (!link) return null;
  return {
    id: link.id,
    patientId: link.patientId,
    formType: link.formType,
    usedAt: link.usedAt,
    patientFullNameEn: link.patient.fullNameEn,
    patientFullNameAr: link.patient.fullNameAr,
    patientPhone: link.patient.phone,
    patientLanguagePref: link.patient.languagePref,
  };
}

/** The active (unused) link for a patient, newest first — the secretary's
 *  copy/state card. Never returns the token of a USED link as "active". */
export async function activeIntakeLinkForPatient(
  patientId: string,
): Promise<{ token: string; formType: IntakeType; createdAt: Date } | null> {
  const link = await db.patientIntakeLink.findFirst({
    where: { patientId, usedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { token: true, formType: true, createdAt: true },
  });
  return link;
}

/** The most recent link of any state — so the file can show "used at {time}"
 *  once a patient has submitted (no active link remains). */
export async function latestIntakeLinkForPatient(
  patientId: string,
): Promise<{ formType: IntakeType; usedAt: Date | null; createdAt: Date } | null> {
  return db.patientIntakeLink.findFirst({
    where: { patientId },
    orderBy: { createdAt: 'desc' },
    select: { formType: true, usedAt: true, createdAt: true },
  });
}

/** The unused link tied to a specific appointment — the confirmation sender
 *  uses this to decide between the standard and the combined template. */
export async function unusedLinkForAppointment(
  appointmentId: string,
): Promise<{ token: string } | null> {
  return db.patientIntakeLink.findFirst({
    where: { appointmentId, usedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { token: true },
  });
}
