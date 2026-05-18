'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SeriesScopePicker } from '@/components/appointments/SeriesScopePicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SeriesEditMode } from '@/lib/appointments/schemas';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (mode: SeriesEditMode) => void;
}

/**
 * Confirm dialog used by paths that don't have their own modal — e.g.
 * the calendar drag-and-drop reschedule. Pops the series-scope picker
 * BEFORE the action fires so the user makes the ONE/FOLLOWING/ALL
 * choice explicitly (Prompt 7b §4.7 — no implicit "if seriesId, apply
 * everything" behaviour).
 */
export function SeriesScopeConfirmDialog({ open, onClose, onConfirm }: Props) {
  const t = useTranslations('calendar.seriesScope');
  const [mode, setMode] = useState<SeriesEditMode>('ONE');
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('confirmTitle')}</DialogTitle>
          <DialogDescription>{t('confirmDescription')}</DialogDescription>
        </DialogHeader>
        <SeriesScopePicker value={mode} onChange={setMode} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={() => onConfirm(mode)}>
            {t('continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
