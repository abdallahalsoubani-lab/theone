import type { AppointmentType, LanguagePref } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * P61 item 1 — WHO a message about an appointment goes to.
 *
 * THE single rule (no appointment-type checks anywhere else): an appointment
 * messages its scalar patient when it has one, otherwise its GROUP members,
 * and a patient-less EVENT messages nobody. Therapist count and room are
 * irrelevant — the P60 gate that also excluded GROUP (and, through the
 * `patientId ?? ''` fallback, every multi-therapist group booking) is what
 * hid the whole "Send a message" section on production.
 *
 * Mirrors `lib/appointments/group.ts → getAppointmentPatientIds` (the hybrid
 * storage seam) and the recipient loop `sendRescheduled` has always used.
 */

export interface RecipientPatient {
  id: string;
  phone: string | null;
  languagePref: LanguagePref;
  fullNameEn: string;
  fullNameAr: string;
  /** The automatic paths skip an unreachable patient; every manual send
   *  forces past it (P60 decision 4). */
  whatsappReachable: boolean;
}

export interface MessageRecipient extends RecipientPatient {
  /**
   * Arrival is PER MEMBERSHIP for a GROUP (`AppointmentPatient.checkedInAt` —
   * July #8 part 3 decision #4) and per appointment for the single-patient
   * types, so the arrival message is offered only to whoever actually arrived.
   */
  checkedInAt: Date | null;
  /** True when the patient is attached through `AppointmentPatient` (a GROUP
   *  member). Their arrival is their own membership row — the appointment
   *  being IN_PROGRESS says nothing about whether THIS member showed up. */
  viaMembership: boolean;
}

export interface RecipientSource {
  appointmentType: AppointmentType;
  checkedInAt: Date | null;
  patient: RecipientPatient | null;
  groupPatients?: { checkedInAt: Date | null; patient: RecipientPatient }[] | null;
}

/** Pure: the patients a message about this appointment is addressed to. */
export function getMessageRecipients(appt: RecipientSource): MessageRecipient[] {
  // A patient-less internal block has nobody to message (P29).
  if (appt.appointmentType === 'EVENT') return [];
  if (appt.patient) {
    return [{ ...appt.patient, checkedInAt: appt.checkedInAt, viaMembership: false }];
  }
  return (appt.groupPatients ?? []).map((g) => ({
    ...g.patient,
    checkedInAt: g.checkedInAt,
    viaMembership: true,
  }));
}

/** Recipients that can actually receive something. */
export function reachableRecipients(recipients: MessageRecipient[]): MessageRecipient[] {
  return recipients.filter((r) => Boolean(r.phone));
}

/** The exact patient columns a recipient needs — shared by every composer. */
export const RECIPIENT_PATIENT_SELECT = {
  id: true,
  phone: true,
  languagePref: true,
  fullNameEn: true,
  fullNameAr: true,
  whatsappReachable: true,
} as const;

export const RECIPIENT_INCLUDE = {
  patient: { select: RECIPIENT_PATIENT_SELECT },
  groupPatients: {
    orderBy: { createdAt: 'asc' },
    select: { checkedInAt: true, patient: { select: RECIPIENT_PATIENT_SELECT } },
  },
} as const;

/** The db-backed twin of `getMessageRecipients` — one query, no type checks. */
export async function loadMessageRecipients(appointmentId: string): Promise<MessageRecipient[]> {
  const appt = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: { appointmentType: true, checkedInAt: true, ...RECIPIENT_INCLUDE },
  });
  return appt ? getMessageRecipients(appt) : [];
}
