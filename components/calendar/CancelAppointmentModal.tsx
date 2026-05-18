'use client';

import { CancellationCategory } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { SeriesScopePicker } from '@/components/appointments/SeriesScopePicker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cancelAppointmentAction } from '@/lib/appointments/actions';
import type { SeriesEditMode } from '@/lib/appointments/schemas';

interface Props {
  open: boolean;
  appointmentId: string | null;
  /** When the appointment is part of a series, the picker also surfaces a scope toggle (Prompt 7b §4.5). */
  seriesId?: string | null;
  onClose: () => void;
  /** Called after a successful cancel so the parent can refresh its view. */
  onCancelled?: () => void;
}

/**
 * Cancel modal with required category picker (Prompt 7b §4.2).
 *
 * Replaces the Prompt 7 quick-cancel that defaulted silently to
 * PATIENT_REQUEST. The category drives Prompt 11 dashboard analytics;
 * the optional notes field carries unstructured Secretary context.
 *
 * Series scope (this only / this + following / all in series) is the
 * spec's §4.5 surface; this modal carries the toggle but only
 * "this only" is implemented end-to-end in commit 1. Commits 2-4 wire
 * the bulk paths through the editSeries action.
 */
export function CancelAppointmentModal({
  open,
  appointmentId,
  seriesId,
  onClose,
  onCancelled,
}: Props) {
  const t = useTranslations('calendar.cancel');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<CancellationCategory>(
    CancellationCategory.PATIENT_REQUEST,
  );
  const [notes, setNotes] = useState('');
  const [notifyPatient, setNotifyPatient] = useState(true);
  const [seriesMode, setSeriesMode] = useState<SeriesEditMode>('ONE');

  function submit() {
    if (!appointmentId) return;
    startTransition(async () => {
      const r = await cancelAppointmentAction({
        id: appointmentId,
        cancellationCategory: category,
        // Category label persisted as the short cancellation reason so
        // older audit log views still show a meaningful one-liner.
        cancellationReason: t(`categories.${category}`),
        cancellationNotes: notes || null,
        notifyPatient,
        seriesMode: seriesId ? seriesMode : 'ONE',
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('cancelledToast'));
      onCancelled?.();
      onClose();
      router.refresh();
    });
  }

  const categories = Object.values(CancellationCategory);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">{t('categoryLegend')}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {categories.map((c) => (
              <label
                key={c}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                  category === c
                    ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
                    : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg'
                }`}
              >
                <input
                  type="radio"
                  name="cancellation-category"
                  value={c}
                  checked={category === c}
                  onChange={() => setCategory(c)}
                  className="size-3"
                />
                {t(`categories.${c}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <Label htmlFor="cancel-notes">{t('notesLabel')}</Label>
          <textarea
            id="cancel-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={t('notesPlaceholder')}
            className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={notifyPatient}
            onChange={(e) => setNotifyPatient(e.target.checked)}
          />
          <span>{t('notifyPatient')}</span>
        </label>

        {seriesId ? (
          <div className="space-y-1">
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {t('seriesNote')}
            </p>
            <SeriesScopePicker value={seriesMode} onChange={setSeriesMode} />
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {t('keep')}
          </Button>
          <Button type="button" variant="destructive" onClick={submit} disabled={pending}>
            {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
