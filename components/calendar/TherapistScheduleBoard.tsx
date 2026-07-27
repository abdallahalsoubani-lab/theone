'use client';

import { SecretaryCalendar } from '@/components/calendar/SecretaryCalendar';
import { useRouter } from '@/i18n/navigation';
import type { CalendarAppointment } from '@/lib/appointments/queries';
import { therapistAppointmentHref } from '@/lib/appointments/links';

/**
 * Read-only full schedule for a Therapist (Prompt 15.6). Reuses the secretary
 * calendar component (day / week / month + navigation, RTL-aware, patient
 * names on every event, no phone per Prompt 15 §1) but with editing disabled
 * — therapists cannot book or drag. Clicking an appointment navigates to the
 * session note (if written) or the patient file, matching the dashboard cards.
 */
export function TherapistScheduleBoard({
  appointments,
  minHour,
  maxHour,
  navById,
  leaves,
}: {
  appointments: CalendarAppointment[];
  minHour: number;
  maxHour: number;
  /** appointmentId → where its card should navigate. */
  navById: Record<string, { patientId: string; sessionNoteId?: string | null }>;
  /** The therapist's OWN approved leaves (Prompt 55 §1) — gray day/week blocks. */
  leaves?: Array<{ id: string; userId: string; startDate: Date; endDate: Date }>;
}) {
  const router = useRouter();
  return (
    <SecretaryCalendar
      appointments={appointments}
      resources={[]}
      leaves={leaves}
      minHour={minHour}
      maxHour={maxHour}
      editable={false}
      onSelectEvent={(appointmentId) => {
        const nav = navById[appointmentId];
        if (nav) router.push(therapistAppointmentHref(nav) as `/${string}`);
      }}
    />
  );
}
