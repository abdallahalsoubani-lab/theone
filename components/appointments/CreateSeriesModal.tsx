'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { createSeriesBatchAction, previewSeriesBatchAction } from '@/lib/appointments/actions';
import { rowInstant, validateBatchRows } from '@/lib/appointments/batch-validation';
import type { DayKey } from '@/lib/appointments/conflicts-time';
import { MAX_BATCH_ROWS } from '@/lib/appointments/schemas';
import { clinicDateKey, clinicHm } from '@/lib/time/clinic';

import { BatchRowsEditor, type BatchRowUI } from './BatchRowsEditor';

interface Person {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  patients: Person[];
  clinicians: Person[];
  rooms: { id: string; name: string }[];
  defaultStartsAt: Date | null;
  defaultTherapistId?: string;
  defaultDurationMinutes: number;
  /** Non-working weekdays from ClinicSettings.businessHours — rows landing
   *  on one flag instantly; the conflict engine re-blocks server-side. */
  closedDays?: DayKey[];
}

/**
 * Multi-appointment batch booking (July 31 item 4 — replaces the Prompt 7b
 * weekly-pattern series). The secretary builds the EXACT list of
 * appointments as rows — date · time · therapist(s) · room · duration —
 * and one save books them all (shared seriesId, atomic). No pattern, no
 * skip/shift/override: a conflicting row is highlighted with the named
 * cause and must be fixed or removed before saving.
 */
export function CreateSeriesModal({
  open,
  onClose,
  patients,
  clinicians,
  rooms,
  defaultStartsAt,
  defaultTherapistId,
  defaultDurationMinutes,
  closedDays,
}: Props) {
  const t = useTranslations('calendar.series');
  const tForm = useTranslations('appointments.form');
  const tCommon = useTranslations('common');
  // The weekday names already exist for the admin hours editor — one source
  // for "Friday" rather than a second copy in this namespace.
  const tDays = useTranslations('admin.settings.days');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [patientId, setPatientId] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<BatchRowUI[]>([]);
  /** Per-row server conflict findings from the submit-time sweep. */
  const [conflicts, setConflicts] = useState<Record<number, unknown[]>>({});
  /** Incomplete-row nagging starts only after the first save attempt. */
  const [attempted, setAttempted] = useState(false);

  const firstRow = (): BatchRowUI => ({
    key: `row-${Math.random().toString(36).slice(2)}`,
    date: defaultStartsAt ? clinicDateKey(defaultStartsAt) : '',
    time: defaultStartsAt ? clinicHm(defaultStartsAt) : '',
    therapistIds: defaultTherapistId ? [defaultTherapistId] : [],
    roomId: '',
    durationMinutes: defaultDurationMinutes,
  });

  // Reset the draft every time the modal re-opens.
  useEffect(() => {
    if (!open) return;
    setPatientId('');
    setNotes('');
    setConflicts({});
    setAttempted(false);
    setRows([firstRow()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultStartsAt, defaultTherapistId, defaultDurationMinutes]);

  const issues = useMemo(
    () => validateBatchRows(rows, { closedDays: closedDays ?? [] }),
    [rows, closedDays],
  );
  const shownIssues = useMemo(
    () => (attempted ? issues : issues.map((list) => list.filter((x) => x !== 'incomplete'))),
    [issues, attempted],
  );
  const hasIssues = issues.some((list) => list.length > 0);
  const closedDayNames = useMemo(
    () => (closedDays ?? []).map((d) => tDays(d)),
    [closedDays, tDays],
  );

  const minDate = clinicDateKey(new Date());

  const patch = (index: number, changes: Partial<BatchRowUI>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...changes } : r)));
    setConflicts({}); // any edit invalidates the last conflict sweep
  };

  // Copy-previous defaults (date cleared): "same setup, next date" is the
  // overwhelmingly common case — two clicks per extra visit.
  const addRow = () => {
    setRows((prev) => {
      if (prev.length >= MAX_BATCH_ROWS) return prev;
      const last = prev[prev.length - 1]!;
      return [...prev, { ...last, key: `row-${Math.random().toString(36).slice(2)}`, date: '' }];
    });
    setConflicts({});
  };

  const removeRow = (index: number) => {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
    setConflicts({});
  };

  const submit = () => {
    setAttempted(true);
    if (!patientId) {
      toast.error(t('patientRequired'));
      return;
    }
    if (hasIssues) {
      toast.error(t('fixRowsError'));
      return;
    }
    const payload = {
      patientId,
      notes: notes || null,
      rows: rows.map((r) => ({
        startsAt: rowInstant(r)!,
        durationMinutes: r.durationMinutes,
        therapistIds: r.therapistIds,
        roomId: r.roomId,
      })),
    };
    startTransition(async () => {
      // Sweep first so EVERY conflicting row lights up at once …
      const preview = await previewSeriesBatchAction(payload);
      if (!preview.ok) {
        toast.error(locale === 'ar' ? preview.error.message_ar : preview.error.message_en);
        return;
      }
      const found: Record<number, unknown[]> = {};
      for (const row of preview.data.rows) {
        if (!row.conflicts.ok) found[row.rowIndex] = row.conflicts.conflicts;
      }
      if (Object.keys(found).length > 0) {
        setConflicts(found);
        toast.error(t('fixRowsError'));
        return;
      }
      // … then create (the service re-checks transactionally — race safety).
      const r = await createSeriesBatchAction(payload);
      if (!r.ok) {
        const rowIndex =
          typeof r.error.details?.rowIndex === 'number' ? r.error.details.rowIndex : null;
        if (rowIndex !== null) {
          const raced = r.error.details?.conflicts;
          if (Array.isArray(raced)) setConflicts({ [rowIndex]: raced });
          toast.error(
            t('rowFailed', {
              index: String(rowIndex + 1),
              message: locale === 'ar' ? r.error.message_ar : r.error.message_en,
            }),
          );
        } else {
          toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        }
        return;
      }
      toast.success(t('createdToast', { count: String(r.data.appointmentIds.length) }));
      onClose();
      router.refresh();
    });
  };

  return (
    <ResponsiveModal open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <ResponsiveModalContent desktopMaxWidth="max-w-3xl">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t('title')}</ResponsiveModalTitle>
          <ResponsiveModalDescription>{t('subtitle')}</ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-1">
          <Label htmlFor="batch-patient">{tForm('patient')}</Label>
          <SearchableSelect
            id="batch-patient"
            value={patientId}
            onChange={setPatientId}
            options={patients.map((p) => ({
              id: p.id,
              label: locale === 'ar' ? p.fullNameAr : p.fullNameEn,
              sublabel: locale === 'ar' ? p.fullNameEn : p.fullNameAr,
            }))}
          />
        </div>

        {/* PT-B3 item 2 — say which days are unbookable BEFORE a date is
            picked. A native date input cannot grey out individual weekdays,
            so the closed days are named up front; picking one still flags the
            row and blocks the save, and the server hard-blocks it regardless. */}
        {closedDayNames.length > 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg px-3 py-2 text-xs text-brand-textMuted">
            {t('closedDaysHint', { days: closedDayNames.join(locale === 'ar' ? '، ' : ', ') })}
          </p>
        ) : null}

        <div className="max-h-[50vh] space-y-3 overflow-y-auto pe-1">
          <BatchRowsEditor
            rows={rows}
            issues={shownIssues}
            conflicts={conflicts}
            clinicians={clinicians}
            rooms={rooms}
            minDate={minDate}
            onChange={patch}
            onRemove={removeRow}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={addRow}
            disabled={rows.length >= MAX_BATCH_ROWS}
            title={
              rows.length >= MAX_BATCH_ROWS
                ? t('maxRows', { max: String(MAX_BATCH_ROWS) })
                : undefined
            }
          >
            {t('addRow')}
          </Button>
          <p className="text-sm font-medium text-brand-navy" aria-live="polite">
            {t('totalSummary', { count: String(rows.length) })}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="batch-notes">{tForm('notes')}</Label>
          <textarea
            id="batch-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <ResponsiveModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? t('saving') : t('save')}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
