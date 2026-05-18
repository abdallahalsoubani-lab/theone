'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  changeTherapistAction,
  previewTherapistAvailabilityAction,
} from '@/lib/appointments/actions';
import type { TherapistAvailabilityRow } from '@/lib/appointments/services';

interface Clinician {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  appointmentId: string;
  patientId: string;
  currentTherapistId: string;
  startsAt: Date;
  durationMinutes: number;
  /** When set the modal shows the "single-occurrence only" notice
   *  (Prompt 7b §4.6). Bulk series-edit modes land in commit 4. */
  seriesId?: string | null;
  clinicians: Clinician[];
}

/**
 * Change-therapist picker — Prompt 7b §4.6.
 *
 * Renders the candidate clinician list with an availability dot per
 * row. The dots reuse the conflict engine via
 * `previewTherapistAvailabilityAction`, batched in parallel.
 *
 * Advisory only: the eventual save calls `changeTherapistAction`,
 * which re-runs the conflict engine server-side and rejects if a
 * conflict has emerged between render and click.
 */
export function ChangeTherapistModal({
  open,
  onClose,
  appointmentId,
  patientId,
  currentTherapistId,
  startsAt,
  durationMinutes,
  seriesId,
  clinicians,
}: Props) {
  const t = useTranslations('calendar.changeTherapist');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<TherapistAvailabilityRow[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setReason('');
      setRows([]);
      return;
    }
    setLoadingAvailability(true);
    void previewTherapistAvailabilityAction({
      appointmentId,
      patientId,
      startsAt: startsAt.toISOString(),
      durationMinutes,
      therapistIds: clinicians.map((c) => c.id),
      excludeTherapistId: currentTherapistId,
    })
      .then((r) => {
        if (!r.ok) {
          toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
          return;
        }
        setRows(r.data.rows);
      })
      .finally(() => setLoadingAvailability(false));
  }, [
    open,
    appointmentId,
    patientId,
    startsAt,
    durationMinutes,
    clinicians,
    currentTherapistId,
    locale,
  ]);

  function submit() {
    if (!picked) return;
    if (picked === currentTherapistId) {
      toast.error(t('noChangeError'));
      return;
    }
    startTransition(async () => {
      const r = await changeTherapistAction({
        id: appointmentId,
        therapistId: picked,
        reason: reason || null,
        overrideConflicts: false,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('reassignedToast'));
      onClose();
      router.refresh();
    });
  }

  const byTherapist = new Map(rows.map((r) => [r.therapistId, r]));
  const others = clinicians.filter((c) => c.id !== currentTherapistId);
  const current = clinicians.find((c) => c.id === currentTherapistId);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        {current ? (
          <div className="rounded-md border border-brand-border bg-brand-bg p-2 text-sm">
            <span className="text-xs uppercase tracking-wide text-brand-textMuted">
              {t('currentLabel')}
            </span>
            <p className="font-medium text-brand-navy">
              {locale === 'ar' ? current.fullNameAr : current.fullNameEn}
            </p>
          </div>
        ) : null}

        {seriesId ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t('seriesNote')}
          </p>
        ) : null}

        <ul className="max-h-72 space-y-1 overflow-y-auto" role="radiogroup">
          {others.map((c) => {
            const row = byTherapist.get(c.id);
            const available = row?.available ?? false;
            const selected = picked === c.id;
            return (
              <li key={c.id}>
                <label
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                    selected
                      ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
                      : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="therapist-pick"
                      value={c.id}
                      checked={selected}
                      onChange={() => setPicked(c.id)}
                    />
                    <span
                      aria-hidden
                      className={`inline-block size-2.5 rounded-full ${
                        loadingAvailability
                          ? 'bg-brand-textMuted/40'
                          : available
                            ? 'bg-emerald-500'
                            : 'bg-red-500'
                      }`}
                    />
                    <span>{locale === 'ar' ? c.fullNameAr : c.fullNameEn}</span>
                  </div>
                  <span className={`text-xs ${available ? 'text-emerald-700' : 'text-red-700'}`}>
                    {loadingAvailability
                      ? '…'
                      : available
                        ? t('availableBadge')
                        : row && row.conflictKinds.length > 0
                          ? t(`conflictKinds.${row.conflictKinds[0]!}`)
                          : t('unavailableBadge')}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="space-y-1">
          <Label htmlFor="reassign-reason">{t('reasonLabel')}</Label>
          <textarea
            id="reassign-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t('reasonPlaceholder')}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={!picked || pending} onClick={submit}>
            {pending ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
