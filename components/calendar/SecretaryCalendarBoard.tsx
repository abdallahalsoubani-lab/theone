'use client';

import type { UserRole } from '@prisma/client';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AppointmentSidePanel,
  type SidePanelAppointment,
} from '@/components/calendar/AppointmentSidePanel';
import { SecretaryCalendar } from '@/components/calendar/SecretaryCalendar';
import { ChangeTherapistModal } from '@/components/appointments/ChangeTherapistModal';
import { CreateAppointmentModal } from '@/components/appointments/CreateAppointmentModal';
import { RescheduleAppointmentModal } from '@/components/appointments/RescheduleAppointmentModal';
import { Button } from '@/components/ui/button';
import { rescheduleAppointmentAction } from '@/lib/appointments/actions';
import { dragReassignTherapistIds } from '@/lib/appointments/drag';
import type { DayKey } from '@/lib/appointments/conflicts-time';
import type { CalendarAppointment } from '@/lib/appointments/queries';
import { RESIZE_MIN_MINUTES } from '@/lib/appointments/schemas';

interface Props {
  appointments: CalendarAppointment[];
  resources: Array<{ id: string; fullNameEn: string; fullNameAr: string; role?: string }>;
  /** Approved leaves overlapping the visible range (Prompt 11 §4.1.5). */
  leaves?: Array<{ id: string; userId: string; startDate: Date; endDate: Date }>;
  patients: Array<{
    id: string;
    fullNameEn: string;
    fullNameAr: string;
    phone: string | null;
    /** NI-5 (Prompt 41): feeds the booking modal's soft first-visit notice. */
    pendingFirstVisit?: boolean;
  }>;
  rooms: Array<{ id: string; name: string }>;
  defaultDurationMinutes: number;
  minHour: number;
  maxHour: number;
  /** Non-working days from ClinicSettings.businessHours (Prompt 22 §4.2) —
   *  greyed out in the series weekday picker. */
  closedDays?: DayKey[];
  canOverride: boolean;
  newAppointmentLabel: string;
  /** Effective viewer role — patient-file links stay inside this role's
   *  interface (Prompt 33, A-19). */
  viewerRole: UserRole;
  /** NI-5 (Prompt 41): open the booking modal on load, prefilled with this
   *  patient; doctorsOnly scopes the clinician picker to doctors (the
   *  patient-file "Book doctor visit" CTA path). */
  autoBook?: { patientId: string; doctorsOnly: boolean };
  /** Prompt 45 row 3 — Doctor's view-only calendar. Hides every mutating
   *  affordance (book button, slot-click booking, drag, resize, panel
   *  actions); the same full-clinic data stays visible. RBAC denies the
   *  server actions independently — this flag only keeps the UI honest. */
  readOnly?: boolean;
}

/**
 * Stateful client wrapper around <SecretaryCalendar>. Holds the modal +
 * side-panel state, dispatches the create / reschedule / status actions
 * to the server, and refreshes the page on success so the calendar reflects
 * the change.
 *
 * Drag-and-drop: we register an onEventDrop handler that calls
 * rescheduleAppointmentAction; the server runs the conflict engine again
 * (Prompt 7 §4.6). On conflict the toast surfaces the reason and
 * `router.refresh()` reverts the optimistic move.
 */
export function SecretaryCalendarBoard({
  appointments,
  resources,
  leaves,
  patients,
  rooms,
  defaultDurationMinutes,
  minHour,
  maxHour,
  closedDays,
  canOverride,
  newAppointmentLabel,
  viewerRole,
  autoBook,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  // Create modal state. autoBook (NI-5 CTA deep-link) opens it immediately,
  // prefilled with the patient — but only for that first open: once the
  // modal closes, the URL param must stop scoping later manual bookings.
  const [createOpen, setCreateOpen] = useState(Boolean(autoBook));
  const [autoBookActive, setAutoBookActive] = useState(Boolean(autoBook));
  const [createSlot, setCreateSlot] = useState<{
    start: Date | null;
    therapistId?: string;
  }>({ start: null });

  // Side panel state.
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelAppt, setPanelAppt] = useState<SidePanelAppointment | null>(null);

  // Change-therapist modal (Prompt 7b §4.6).
  const [changeTherapistOpen, setChangeTherapistOpen] = useState(false);
  // Prompt 48 — precision reschedule from the side panel (drag stays as-is).
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const handleSlotSelect = (slot: { start: Date; end: Date; resourceId?: string }) => {
    if (readOnly) return; // Prompt 45 row 3 — empty-slot click books nothing
    setCreateSlot({ start: slot.start, therapistId: slot.resourceId });
    setCreateOpen(true);
  };

  const handleEventSelect = (appointmentId: string) => {
    const found = appointments.find((a) => a.id === appointmentId);
    if (!found) return;
    setPanelAppt({
      id: found.id,
      patientId: found.patientId ?? '',
      // GROUP has no scalar patient — head the panel with the workshop label if
      // set, else the members' names (July #8 part 3). EVENT falls back to its
      // title as before.
      patientFullNameEn:
        found.patientFullNameEn ||
        found.title ||
        found.groupPatients.map((p) => p.fullNameEn).join(', '),
      patientFullNameAr:
        found.patientFullNameAr ||
        found.title ||
        found.groupPatients.map((p) => p.fullNameAr).join('، '),
      // Phone is fetched lazily; the calendar list query is lean. For now,
      // leave blank and Prompt 7b can fetch on open if needed.
      patientPhone: '',
      therapists: found.therapists,
      roomName: found.roomName,
      startsAt: found.startsAt,
      durationMinutes: found.durationMinutes,
      status: found.status,
      notes: found.notes,
      seriesId: found.seriesId,
    });
    setPanelOpen(true);
  };

  const dispatchReschedule = (args: {
    appointmentId: string;
    start: Date;
    therapistIds?: string[];
    durationMinutes: number;
  }) => {
    startTransition(async () => {
      const r = await rescheduleAppointmentAction({
        id: args.appointmentId,
        startsAt: args.start,
        durationMinutes: args.durationMinutes,
        // Omitted → keep the existing therapist set (multi-therapist time-only
        // move); set → reassign (single-therapist lane change). Prompt 20.
        ...(args.therapistIds ? { therapistIds: args.therapistIds } : {}),
        overrideConflicts: false,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        router.refresh(); // revert the optimistic move
        return;
      }
      toast.success(locale === 'ar' ? 'تم نقل الموعد' : 'Appointment rescheduled');
      router.refresh();
    });
  };

  const handleEventDrop = (args: { appointmentId: string; start: Date; resourceId?: string }) => {
    const existing = appointments.find((a) => a.id === args.appointmentId);
    if (!existing) return;
    // Prompt 20 decision #2 — single → lane reassign, multi → time-only move
    // (all therapists kept). The rule lives in lib/appointments/drag.ts.
    const therapistIds = dragReassignTherapistIds(
      existing.therapists.map((t) => t.id),
      args.resourceId,
    );
    // Prompt 45 rows 1+2 — dragging a series member moves ONLY that
    // occurrence; no scope dialog. Siblings are untouched.
    dispatchReschedule({
      appointmentId: args.appointmentId,
      start: args.start,
      therapistIds,
      durationMinutes: existing.durationMinutes,
    });
  };

  // Edge-resize → duration-only change (July #6). Start is unchanged. The
  // server runs the FULL conflict engine here, same as a drag (PT-B2 §5.2 —
  // "free resize" withdrawn): a rejection comes back as a localized error and
  // the optimistic resize reverts. Always a single-appointment op — no series
  // scope picker, even for a series member.
  const handleEventResize = (args: { appointmentId: string; start: Date; end: Date }) => {
    const existing = appointments.find((a) => a.id === args.appointmentId);
    if (!existing) return;
    const durationMinutes = Math.max(
      RESIZE_MIN_MINUTES,
      Math.round((args.end.getTime() - existing.startsAt.getTime()) / 60_000),
    );
    if (durationMinutes === existing.durationMinutes) return; // no real change
    startTransition(async () => {
      const r = await rescheduleAppointmentAction({
        id: args.appointmentId,
        startsAt: existing.startsAt, // unchanged — duration-only
        durationMinutes,
        resize: true,
        overrideConflicts: false,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        router.refresh(); // revert the optimistic resize
        return;
      }
      toast.success(locale === 'ar' ? 'تم تعديل مدة الموعد' : 'Appointment duration updated');
      router.refresh();
    });
  };

  return (
    <div className={pending ? 'opacity-90' : ''}>
      {readOnly ? null : (
        <div className="mb-3 flex justify-end">
          <Button
            type="button"
            onClick={() => {
              setCreateSlot({ start: new Date() });
              setCreateOpen(true);
            }}
          >
            {newAppointmentLabel}
          </Button>
        </div>
      )}

      <SecretaryCalendar
        appointments={appointments}
        resources={resources}
        leaves={leaves}
        minHour={minHour}
        maxHour={maxHour}
        editable={!readOnly}
        onSelectSlot={handleSlotSelect}
        onSelectEvent={handleEventSelect}
        onEventDrop={handleEventDrop}
        onEventResize={handleEventResize}
      />

      <CreateAppointmentModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setAutoBookActive(false);
        }}
        patients={patients}
        // The full staff list goes in; the modal narrows it to doctors or
        // therapists from the chosen session kind (PT-B4 item 1). This used to
        // hard-filter to doctors on the CTA path, which left the secretary
        // stuck if the doctor visit had to become a therapist booking.
        clinicians={resources}
        rooms={rooms}
        defaultStartsAt={createSlot.start}
        defaultTherapistId={createSlot.therapistId}
        defaultDurationMinutes={defaultDurationMinutes}
        closedDays={closedDays}
        canOverride={canOverride}
        defaultPatientId={autoBookActive ? autoBook?.patientId : undefined}
        // NI-5 CTA path: "Book doctor visit" opens on the doctor session —
        // that is the button's whole purpose — but stays switchable.
        defaultSessionKind={autoBookActive && autoBook?.doctorsOnly ? 'DOCTOR' : 'THERAPIST'}
      />

      <AppointmentSidePanel
        open={panelOpen}
        appointment={panelAppt}
        viewerRole={viewerRole}
        readOnly={readOnly}
        onClose={() => setPanelOpen(false)}
        onChangeTherapist={panelAppt && !readOnly ? () => setChangeTherapistOpen(true) : undefined}
        onEdit={panelAppt && !readOnly ? () => setRescheduleOpen(true) : undefined}
      />

      <RescheduleAppointmentModal
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        canOverride={canOverride}
        target={
          panelAppt
            ? {
                id: panelAppt.id,
                startsAt: panelAppt.startsAt,
                durationMinutes: panelAppt.durationMinutes,
                patientId: panelAppt.patientId,
                therapistIds: panelAppt.therapists.map((th) => th.id),
              }
            : null
        }
      />

      {panelAppt ? (
        <ChangeTherapistModal
          open={changeTherapistOpen}
          onClose={() => setChangeTherapistOpen(false)}
          appointmentId={panelAppt.id}
          patientId={panelAppt.patientId}
          currentTherapistIds={panelAppt.therapists.map((th) => th.id)}
          startsAt={panelAppt.startsAt}
          durationMinutes={panelAppt.durationMinutes}
          clinicians={resources}
        />
      ) : null}
    </div>
  );
}
