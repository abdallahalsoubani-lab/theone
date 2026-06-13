'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { SeriesScopePicker } from '@/components/appointments/SeriesScopePicker';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import {
  changeTherapistAction,
  previewTherapistAvailabilityAction,
} from '@/lib/appointments/actions';
import type { SeriesEditMode } from '@/lib/appointments/schemas';
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
  /** The appointment's current therapist set (Prompt 20). */
  currentTherapistIds: string[];
  startsAt: Date;
  durationMinutes: number;
  /** When set the modal shows the series-scope picker (Prompt 7b §4.6). */
  seriesId?: string | null;
  clinicians: Clinician[];
}

/**
 * Manage-therapists picker — Prompt 20 (was the single "change therapist"
 * picker, Prompt 7b §4.6). Multi-select: toggle the therapists on this session
 * (min 1). Each row shows an availability dot from the conflict engine
 * (advisory; the save re-checks server-side). Saving sets the full set; the
 * service diffs add/remove and notifies.
 */
export function ChangeTherapistModal({
  open,
  onClose,
  appointmentId,
  patientId,
  currentTherapistIds,
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
  const [selected, setSelected] = useState<string[]>(currentTherapistIds);
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<TherapistAvailabilityRow[]>([]);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [seriesMode, setSeriesMode] = useState<SeriesEditMode>('ONE');

  const currentKey = [...currentTherapistIds].sort().join(',');

  useEffect(() => {
    if (!open) {
      setReason('');
      setRows([]);
      return;
    }
    setSelected(currentTherapistIds);
    setLoadingAvailability(true);
    void previewTherapistAvailabilityAction({
      appointmentId,
      patientId,
      startsAt: startsAt.toISOString(),
      durationMinutes,
      therapistIds: clinicians.map((c) => c.id),
    })
      .then((r) => {
        if (!r.ok) {
          toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
          return;
        }
        setRows(r.data.rows);
      })
      .finally(() => setLoadingAvailability(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointmentId, patientId, startsAt, durationMinutes, clinicians, currentKey, locale]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  function submit() {
    if (selected.length === 0) {
      toast.error(t('minOneError'));
      return;
    }
    const selKey = [...selected].sort().join(',');
    if (selKey === currentKey) {
      toast.error(t('noChangeError'));
      return;
    }
    startTransition(async () => {
      const r = await changeTherapistAction({
        id: appointmentId,
        therapistIds: selected,
        reason: reason || null,
        overrideConflicts: false,
        seriesMode: seriesId ? seriesMode : 'ONE',
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

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <ResponsiveModalContent>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('title')}</ResponsiveModalTitle>
          <ResponsiveModalDescription>{t('subtitle')}</ResponsiveModalDescription>
        </ResponsiveModalHeader>

        {seriesId ? <SeriesScopePicker value={seriesMode} onChange={setSeriesMode} /> : null}

        <ul className="max-h-72 space-y-1 overflow-y-auto" role="group" aria-label={t('title')}>
          {clinicians.map((c) => {
            const row = byTherapist.get(c.id);
            const available = row?.available ?? false;
            const isSelected = selected.includes(c.id);
            return (
              <li key={c.id}>
                <label
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                    isSelected
                      ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
                      : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      value={c.id}
                      checked={isSelected}
                      onChange={() => toggle(c.id)}
                    />
                    <span
                      aria-hidden
                      className={`inline-block size-2.5 rounded-full ${
                        loadingAvailability
                          ? 'bg-brand-textMuted/40'
                          : available || isSelected
                            ? 'bg-emerald-500'
                            : 'bg-red-500'
                      }`}
                    />
                    <span>{locale === 'ar' ? c.fullNameAr : c.fullNameEn}</span>
                  </div>
                  <span
                    className={`text-xs ${available || isSelected ? 'text-emerald-700' : 'text-red-700'}`}
                  >
                    {loadingAvailability
                      ? '…'
                      : available || isSelected
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

        <ResponsiveModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" disabled={selected.length === 0 || pending} onClick={submit}>
            {pending ? t('saving') : t('save')}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
