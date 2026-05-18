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
import { CreateAppointmentModal } from '@/components/appointments/CreateAppointmentModal';
import { Button } from '@/components/ui/button';
import { rescheduleAppointmentAction } from '@/lib/appointments/actions';
import type { CalendarAppointment } from '@/lib/appointments/queries';

interface Props {
  appointments: CalendarAppointment[];
  resources: Array<{ id: string; fullNameEn: string; fullNameAr: string }>;
  patients: Array<{ id: string; fullNameEn: string; fullNameAr: string; phone: string }>;
  rooms: Array<{ id: string; name: string }>;
  defaultDurationMinutes: number;
  minHour: number;
  maxHour: number;
  canOverride: boolean;
  newAppointmentLabel: string;
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
  patients,
  rooms,
  defaultDurationMinutes,
  minHour,
  maxHour,
  canOverride,
  newAppointmentLabel,
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
      therapistFullNameEn: found.therapistFullNameEn,
      therapistFullNameAr: found.therapistFullNameAr,
      roomName: found.roomName,
      startsAt: found.startsAt,
      durationMinutes: found.durationMinutes,
      status: found.status,
      notes: found.notes,
    });
    setPanelOpen(true);
  };

  const handleEventDrop = (args: { appointmentId: string; start: Date; resourceId?: string }) => {
    const existing = appointments.find((a) => a.id === args.appointmentId);
    if (!existing) return;
    startTransition(async () => {
      const r = await rescheduleAppointmentAction({
        id: args.appointmentId,
        startsAt: args.start,
        durationMinutes: existing.durationMinutes,
        therapistId: args.resourceId ?? existing.therapistId,
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

      <SecretaryCalendar
        appointments={appointments}
        resources={resources}
        minHour={minHour}
        maxHour={maxHour}
        onSelectSlot={handleSlotSelect}
        onSelectEvent={handleEventSelect}
        onEventDrop={handleEventDrop}
      />

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
      />
    </div>
  );
}
