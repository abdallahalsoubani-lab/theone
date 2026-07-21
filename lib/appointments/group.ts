import type { AppointmentType } from '@prisma/client';

/**
 * Patient id(s) for an appointment, regardless of the storage mechanism
 * (July #8 part 3, choice B — Hybrid):
 *   - SESSION / STRETCHING → the single scalar `patientId`
 *   - GROUP → the `AppointmentPatient` (M2M) membership rows
 *   - EVENT → none
 *
 * This is the ONLY place that knows about the hybrid split, so a future switch
 * to a full M2M (choice A) changes just this module.
 */
export function getAppointmentPatientIds(appt: {
  appointmentType: AppointmentType;
  patientId: string | null;
  groupPatients?: { patientId: string }[] | null;
}): string[] {
  if (appt.appointmentType === 'GROUP') return (appt.groupPatients ?? []).map((g) => g.patientId);
  return appt.patientId ? [appt.patientId] : [];
}

/** True when the appointment carries a set of patients (a GROUP). */
export function isGroupAppointment(appointmentType: AppointmentType): boolean {
  return appointmentType === 'GROUP';
}
