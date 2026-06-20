'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AppointmentSidePanel,
  type SidePanelAppointment,
} from '@/components/calendar/AppointmentSidePanel';
import { SecretaryCalendar } from '@/components/calendar/SecretaryCalendar';
import { CustomDayView } from '@/components/calendar/custom/CustomDayView';
import { ChangeTherapistModal } from '@/components/appointments/ChangeTherapistModal';
import { CreateAppointmentModal } from '@/components/appointments/CreateAppointmentModal';
import { SeriesScopeConfirmDialog } from '@/components/appointments/SeriesScopeConfirmDialog';
import { Button } from '@/components/ui/button';
import { rescheduleAppointmentAction } from '@/lib/appointments/actions';
import type { CalendarAppointment } from '@/lib/appointments/queries';
import type { SeriesEditMode } from '@/lib/appointments/schemas';

interface Props {
  appointments: CalendarAppointment[];
  resources: Array<{ id: string; fullNameEn: string; fullNameAr: string }>;
  /** Approved leaves overlapping the visible range (Prompt 11 §4.1.5). */
  leaves?: Array<{ id: string; userId: string; startDate: Date; endDate: Date }>;
  patients: Array<{ id: string; fullNameEn: string; fullNameAr: string; phone: string | null }>;
  rooms: Array<{ id: string; name: string }>;
  defaultDurationMinutes: number;
  minHour: number;
  maxHour: number;
  canOverride: boolean;
  newAppointmentLabel: string;
  /** Custom Calendar Phase 1 — when true, render the new static custom day
   *  view (read-only, flagged) instead of react-big-calendar. Default false. */
  customCalendar?: boolean;
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
  canOverride,
  newAppointmentLabel,
  customCalendar = false,
}: Props) {
  const router = useRouter();
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  // Create modal state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createSlot, setCreateSlot] = useState<{
    start: Date | null;
    therapistId?: string;
  }>({ start: null });

  // Side panel state.
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelAppt, setPanelAppt] = useState<SidePanelAppointment | null>(null);

  // Change-therapist modal (Prompt 7b §4.6).
  const [changeTherapistOpen, setChangeTherapistOpen] = useState(false);

  // Pending drag-reschedule needing series-scope confirmation
  // (Prompt 7b §4.7). When the dragged appointment is part of a series
  // we hold the move + open the scope picker before firing the action.
  const [pendingDrop, setPendingDrop] = useState<{
    appointmentId: string;
    start: Date;
    /** Set only when a single-therapist drag reassigns to a new lane; omitted
     *  for a multi-therapist time-only move (Prompt 20). */
    therapistIds?: string[];
    durationMinutes: number;
    seriesId: string | null;
  } | null>(null);

  const handleSlotSelect = (slot: { start: Date; end: Date; resourceId?: string }) => {
    setCreateSlot({ start: slot.start, therapistId: slot.resourceId });
    setCreateOpen(true);
  };

  const handleEventSelect = (appointmentId: string) => {
    const found = appointments.find((a) => a.id === appointmentId);
    if (!found) return;
    setPanelAppt({
      id: found.id,
      patientId: found.patientId,
      patientFullNameEn: found.patientFullNameEn,
      patientFullNameAr: found.patientFullNameAr,
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

  const dispatchReschedule = (
    args: {
      appointmentId: string;
      start: Date;
      therapistIds?: string[];
      durationMinutes: number;
    },
    seriesMode: SeriesEditMode,
  ) => {
    startTransition(async () => {
      const r = await rescheduleAppointmentAction({
        id: args.appointmentId,
        startsAt: args.start,
        durationMinutes: args.durationMinutes,
        // Omitted → keep the existing therapist set (multi-therapist time-only
        // move); set → reassign (single-therapist lane change). Prompt 20.
        ...(args.therapistIds ? { therapistIds: args.therapistIds } : {}),
        overrideConflicts: false,
        seriesMode,
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
    // Drag interaction (Prompt 20, decision #2):
    //  - single-therapist appointment dropped into another lane → reassign it
    //    to that lane's therapist (today's behavior preserved);
    //  - multi-therapist session dragged → time-only move, ALL therapists kept,
    //    no reassignment from the target lane (to change WHO is on it, use
    //    "Manage therapists" in the side panel).
    const isMulti = existing.therapists.length > 1;
    const therapistIds =
      !isMulti && args.resourceId && args.resourceId !== existing.therapists[0]?.id
        ? [args.resourceId]
        : undefined;
    const drop = {
      appointmentId: args.appointmentId,
      start: args.start,
      therapistIds,
      durationMinutes: existing.durationMinutes,
      seriesId: existing.seriesId,
    };
    if (existing.seriesId) {
      setPendingDrop(drop);
      return;
    }
    dispatchReschedule(drop, 'ONE');
  };

  return (
    <div className={pending ? 'opacity-90' : ''}>
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

      {customCalendar ? (
        // Phase 1: static, read-only — no interaction wiring yet (Phases 2–3).
        <CustomDayView
          appointments={appointments}
          resources={resources}
          minHour={minHour}
          maxHour={maxHour}
        />
      ) : (
        <SecretaryCalendar
          appointments={appointments}
          resources={resources}
          leaves={leaves}
          minHour={minHour}
          maxHour={maxHour}
          onSelectSlot={handleSlotSelect}
          onSelectEvent={handleEventSelect}
          onEventDrop={handleEventDrop}
        />
      )}

      <CreateAppointmentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        patients={patients}
        clinicians={resources}
        rooms={rooms}
        defaultStartsAt={createSlot.start}
        defaultTherapistId={createSlot.therapistId}
        defaultDurationMinutes={defaultDurationMinutes}
        canOverride={canOverride}
      />

      <AppointmentSidePanel
        open={panelOpen}
        appointment={panelAppt}
        onClose={() => setPanelOpen(false)}
        onChangeTherapist={panelAppt ? () => setChangeTherapistOpen(true) : undefined}
      />

      <SeriesScopeConfirmDialog
        open={pendingDrop !== null}
        onClose={() => {
          // User cancelled the scope picker — revert the optimistic drag.
          setPendingDrop(null);
          router.refresh();
        }}
        onConfirm={(mode) => {
          if (!pendingDrop) return;
          const drop = pendingDrop;
          setPendingDrop(null);
          dispatchReschedule(drop, mode);
        }}
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
          seriesId={panelAppt.seriesId}
          clinicians={resources}
        />
      ) : null}
    </div>
  );
}
