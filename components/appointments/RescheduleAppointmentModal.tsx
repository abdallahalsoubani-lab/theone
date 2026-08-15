'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { previewConflictsAction, rescheduleAppointmentAction } from '@/lib/appointments/actions';
import { hasHardBlockedConflict, type ConflictResult } from '@/lib/appointments/conflicts';
import { formatClinicDateTimeLocal, parseClinicDateTimeLocal } from '@/lib/time/clinic';

export interface RescheduleTarget {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  /** For the LIVE preview only — the server re-derives both on submit. */
  patientId: string | null;
  therapistIds: string[];
}

/**
 * Precision reschedule modal (Prompt 48 — "التحكم مش بس بالسحب").
 *
 * One shared flow behind every entry point: the calendar side panel and the
 * patient-file appointment rows both open THIS modal, and it submits through
 * the same `rescheduleAppointmentAction` the drag path uses — so the full
 * conflict engine (therapist/room/same-patient P42), working-hours checks,
 * the reminder re-scheduling, the audit row, and the Prompt-48 reschedule
 * message all behave identically no matter where the change came from.
 *
 * Scope: date + time + duration. Clinician changes have their own modal
 * (Manage therapists); the room is intentionally left untouched (the action
 * keeps it when omitted — P34 rule).
 *
 * Series members (Prompt 45 rows 1+2): the edit always applies to THIS
 * occurrence only — the scope chooser was removed from every edit path, so
 * the modal is identical whether or not the appointment belongs to a series.
 */
export function RescheduleAppointmentModal({
  open,
  target,
  onClose,
  canOverride = false,
}: {
  open: boolean;
  target: RescheduleTarget | null;
  onClose: () => void;
  canOverride?: boolean;
}) {
  const t = useTranslations('appointments.reschedule');
  const tConflicts = useTranslations('appointments.conflicts');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(30);
  const [conflicts, setConflicts] = useState<ConflictResult | null>(null);

  // Prefill from the target each time the modal opens.
  useEffect(() => {
    if (!open || !target) return;
    setStartsAt(formatClinicDateTimeLocal(target.startsAt));
    setDuration(target.durationMinutes);
    setConflicts(null);
  }, [open, target]);

  // Live conflict preview at the picked slot (same debounce pattern as the
  // create modal; the server remains the authority on submit).
  useEffect(() => {
    if (!open || !target || !startsAt) return;
    const handle = setTimeout(() => {
      void previewConflictsAction({
        appointmentId: target.id, // excluded from its own overlap calc
        patientId: target.patientId,
        therapistIds: target.therapistIds,
        startsAt: (parseClinicDateTimeLocal(startsAt) ?? new Date(NaN)).toISOString(),
        durationMinutes: duration,
      }).then((r) => {
        if (r.ok) setConflicts(r.data);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [open, target, startsAt, duration]);

  if (!target) return null;

  const parsed = parseClinicDateTimeLocal(startsAt);
  const startChanged = parsed !== null && parsed.getTime() !== target.startsAt.getTime();
  const durationChanged = duration !== target.durationMinutes;
  const hasConflicts = conflicts !== null && !conflicts.ok;
  const hardBlocked = hasConflicts && hasHardBlockedConflict(conflicts.conflicts);
  const canSubmit = parsed !== null && duration >= 5 && (startChanged || durationChanged);

  const submit = (override: boolean) =>
    startTransition(async () => {
      const r = await rescheduleAppointmentAction({
        id: target.id,
        startsAt: parsed!,
        durationMinutes: duration,
        overrideConflicts: override,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('savedToast'));
      onClose();
      router.refresh();
    });

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('title')}</ResponsiveModalTitle>
          <ResponsiveModalDescription>{t('subtitle')}</ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="resched-starts">{t('newStart')}</Label>
            <Input
              id="resched-starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="resched-duration">{t('duration')}</Label>
            <Input
              id="resched-duration"
              type="number"
              min={5}
              max={480}
              step={15}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value || '30', 10))}
            />
          </div>

          {hasConflicts ? (
            <div
              role="alert"
              className={`rounded-md border p-3 text-sm ${
                hardBlocked
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {hardBlocked ? tConflicts('hardBlockTitle') : tConflicts('title')}
            </div>
          ) : null}
        </div>

        <ResponsiveModalFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {tCommon('cancel')}
          </Button>
          {hasConflicts && !hardBlocked && canOverride ? (
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !canSubmit}
              onClick={() => submit(true)}
            >
              {tConflicts('overrideButton')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={pending || !canSubmit || hardBlocked}
              onClick={() => submit(false)}
            >
              {t('save')}
            </Button>
          )}
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
