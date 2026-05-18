'use client';

import { AppointmentStatus } from '@prisma/client';
import { Check, CircleDot, ExternalLink, Pencil, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Link } from '@/i18n/navigation';
import { cancelAppointmentAction, updateStatusAction } from '@/lib/appointments/actions';
import { formatDate, formatTime } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';

export interface SidePanelAppointment {
  id: string;
  patientId: string;
  patientFullNameEn: string;
  patientFullNameAr: string;
  patientPhone: string;
  therapistFullNameEn: string;
  therapistFullNameAr: string;
  roomName: string | null;
  startsAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string | null;
}

interface Props {
  open: boolean;
  appointment: SidePanelAppointment | null;
  onClose: () => void;
  onEdit?: () => void;
}

/**
 * Slides in from the inline-end edge (RTL-aware via shadcn Sheet `end` side).
 * Patient header + appointment details + status actions gated by the legal
 * STATUS_TRANSITIONS map (see lib/appointments/status.ts).
 *
 * Cancel uses a quick-confirm with a default category — for the full reason
 * picker, Prompt 7b will replace this with the modal described in §4.9.
 */
export function AppointmentSidePanel({ open, appointment, onClose, onEdit }: Props) {
  const t = useTranslations('appointments');
  const tStatus = useTranslations('appointments.status');
  const tActions = useTranslations('appointments.actions');
  const tSide = useTranslations('appointments.sidePanel');
  const tToasts = useTranslations('appointments.toasts');
  const router = useRouter();
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const [pending, startTransition] = useTransition();

  if (!appointment) {
    return (
      <Sheet open={open} onOpenChange={(o) => (o ? null : onClose())}>
        <SheetContent side="end" />
      </Sheet>
    );
  }

  const patientName =
    locale === 'ar' ? appointment.patientFullNameAr : appointment.patientFullNameEn;
  const therapistName =
    locale === 'ar' ? appointment.therapistFullNameAr : appointment.therapistFullNameEn;

  const handleStatus = (to: AppointmentStatus, successKey: string) =>
    startTransition(async () => {
      const r = await updateStatusAction({ id: appointment.id, to });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(tToasts(successKey));
      router.refresh();
      onClose();
    });

  // Quick-cancel with a default category. Prompt 7b will replace with the
  // category-picker modal.
  const handleCancel = () =>
    startTransition(async () => {
      const r = await cancelAppointmentAction({
        id: appointment.id,
        cancellationCategory: 'PATIENT_REQUEST',
        cancellationReason: 'Cancelled from calendar',
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      if (r.data.flaggedShortNotice) {
        toast.warning(t('cancel.shortNoticeWarning'));
      } else {
        toast.success(tToasts('cancelled'));
      }
      router.refresh();
      onClose();
    });

  const status = appointment.status;
  const canConfirm = status === AppointmentStatus.SCHEDULED;
  const canCheckIn =
    status === AppointmentStatus.SCHEDULED || status === AppointmentStatus.CONFIRMED;
  const canComplete = status === AppointmentStatus.IN_PROGRESS;
  const canCancel =
    status === AppointmentStatus.SCHEDULED || status === AppointmentStatus.CONFIRMED;
  const canNoShow =
    status === AppointmentStatus.SCHEDULED || status === AppointmentStatus.CONFIRMED;

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <SheetContent side="end" className="space-y-4 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{patientName}</SheetTitle>
          <SheetDescription>{formatPhone(appointment.patientPhone)}</SheetDescription>
        </SheetHeader>

        <Link
          href={`/secretary/patients/${appointment.patientId}`}
          className="inline-flex items-center gap-1 text-sm text-brand-cyan hover:underline"
        >
          <ExternalLink className="size-3" />
          {tSide('openPatientFile')}
        </Link>

        <div className="space-y-2 rounded-md border border-brand-border bg-brand-bg p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-brand-textMuted">
              {tSide('appointmentDetails')}
            </span>
            <Badge variant="cyan">{tStatus(statusLabelKey(status))}</Badge>
          </div>
          <p className="font-medium text-brand-navy">
            {formatDate(appointment.startsAt, intlLocale)} ·{' '}
            {formatTime(appointment.startsAt, intlLocale)}
          </p>
          <p className="text-brand-textMuted">
            {therapistName} · {appointment.durationMinutes} min
            {appointment.roomName ? ` · ${appointment.roomName}` : ''}
          </p>
          {appointment.notes ? (
            <p className="whitespace-pre-wrap text-xs text-brand-text">{appointment.notes}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          {canConfirm ? (
            <Button
              type="button"
              className="w-full justify-start"
              variant="outline"
              disabled={pending}
              onClick={() => handleStatus(AppointmentStatus.CONFIRMED, 'confirmed')}
            >
              <Check className="me-2 size-4" />
              {tActions('confirm')}
            </Button>
          ) : null}
          {canCheckIn ? (
            <Button
              type="button"
              className="w-full justify-start"
              variant="outline"
              disabled={pending}
              onClick={() => handleStatus(AppointmentStatus.IN_PROGRESS, 'markedInProgress')}
            >
              <CircleDot className="me-2 size-4" />
              {tActions('checkIn')}
            </Button>
          ) : null}
          {canComplete ? (
            // Post-Prompt 9: completing an appointment requires writing
            // a session note. The button navigates to the SOAP form;
            // saving the note transitions the appointment to COMPLETED
            // in the same transaction. Admin-override for backfilling
            // without a note is intentionally not exposed in this UI.
            <Button asChild className="w-full justify-start" variant="outline" disabled={pending}>
              <Link href={`/therapist/sessions/${appointment.id}/note/new` as `/${string}`}>
                <Check className="me-2 size-4" />
                {tActions('complete')}
              </Link>
            </Button>
          ) : null}
          {canNoShow ? (
            <Button
              type="button"
              className="w-full justify-start"
              variant="outline"
              disabled={pending}
              onClick={() => handleStatus(AppointmentStatus.NO_SHOW, 'markedNoShow')}
            >
              <X className="me-2 size-4" />
              {tActions('noShow')}
            </Button>
          ) : null}
          {canCancel ? (
            <Button
              type="button"
              className="w-full justify-start text-destructive"
              variant="outline"
              disabled={pending}
              onClick={handleCancel}
            >
              <X className="me-2 size-4" />
              {tActions('cancel')}
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              type="button"
              className="w-full justify-start"
              variant="ghost"
              disabled={pending}
              onClick={onEdit}
            >
              <Pencil className="me-2 size-4" />
              {tActions('edit')}
            </Button>
          ) : null}
        </div>

        <p className="text-xs text-brand-textMuted">{tSide('linkedPlan')}</p>
        {status === AppointmentStatus.COMPLETED ? (
          <p className="text-xs text-brand-textMuted">{tSide('sessionNoteCta')}</p>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function statusLabelKey(s: AppointmentStatus): string {
  switch (s) {
    case 'SCHEDULED':
      return 'scheduled';
    case 'CONFIRMED':
      return 'confirmed';
    case 'IN_PROGRESS':
      return 'inProgress';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    case 'NO_SHOW':
      return 'noShow';
  }
}
