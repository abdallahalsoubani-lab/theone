'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createSeriesAction,
  previewSeriesAction,
  previewSeriesSlotAction,
} from '@/lib/appointments/actions';
import type { ConflictResult } from '@/lib/appointments/conflicts';
import { WEEKDAYS, type Weekday } from '@/lib/appointments/recurrence';
import type { SeriesResolution } from '@/lib/appointments/schemas';
import type { SeriesPreviewOccurrence } from '@/lib/appointments/services';
import { formatDate, formatTime } from '@/lib/format/date';

interface Patient {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

interface Clinician {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

interface Room {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  patients: Patient[];
  clinicians: Clinician[];
  rooms: Room[];
  defaultStartsAt: Date | null;
  defaultTherapistId?: string;
  defaultDurationMinutes: number;
  canOverride: boolean;
}

/**
 * Recurring series builder — Prompt 7b §4.4.
 *
 * Pattern: weekly with N occurrences across one-or-more chosen weekdays.
 * For every conflicting occurrence the user must pick one of four
 * resolutions:
 *
 *   - Skip            — drop this occurrence entirely.
 *   - Shift +1 day    — try the same time the next day; re-run engine.
 *   - Shift +1 week   — try the next pattern occurrence; re-run engine.
 *   - Override        — book despite conflicts (gated on
 *                       `appointments.override_conflict`).
 *
 * No silent acceptance of any shifted slot — after either shift the
 * server re-runs the conflict engine on the new time, and if conflicts
 * persist the row stays "Resolve" until the user picks again.
 *
 * Save: the server re-expands the rule, re-validates every final slot,
 * and inserts the entire series in a single transaction. A race on any
 * occurrence aborts the whole series with the failing index surfaced.
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
  canOverride,
}: Props) {
  const t = useTranslations('calendar.series');
  const tForm = useTranslations('appointments.form');
  const tCommon = useTranslations('common');
  const tConflicts = useTranslations('appointments.conflicts');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [patientId, setPatientId] = useState('');
  const [therapistId, setTherapistId] = useState(defaultTherapistId ?? '');
  const [roomId, setRoomId] = useState('');
  const [startsAt, setStartsAt] = useState(defaultStartsAt ? toLocalInput(defaultStartsAt) : '');
  const [duration, setDuration] = useState(defaultDurationMinutes);
  const [notes, setNotes] = useState('');
  const [interval, setInterval] = useState(1);
  const [count, setCount] = useState(4);
  const [byWeekday, setByWeekday] = useState<Weekday[]>(() => {
    if (!defaultStartsAt) return ['SUN'];
    return [WEEKDAYS[defaultStartsAt.getUTCDay()]!];
  });

  interface SlotState {
    index: number;
    startsAt: Date;
    durationMinutes: number;
    conflicts: ConflictResult;
    /** `null` until the user makes a decision; cleared back to `null`
     *  whenever the slot's conflicts re-appear after a shift. */
    resolution: SeriesResolution | null;
  }
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [previewing, setPreviewing] = useState(false);

  // Reset state every time the modal re-opens so a previous draft
  // doesn't bleed in.
  useEffect(() => {
    if (!open) return;
    setTherapistId(defaultTherapistId ?? '');
    setStartsAt(defaultStartsAt ? toLocalInput(defaultStartsAt) : '');
    setDuration(defaultDurationMinutes);
    setSlots([]);
    setByWeekday(defaultStartsAt ? [WEEKDAYS[defaultStartsAt.getUTCDay()]!] : ['SUN']);
  }, [open, defaultStartsAt, defaultTherapistId, defaultDurationMinutes]);

  const canPreview = patientId && therapistId && startsAt && byWeekday.length > 0 && count > 0;

  // Run the initial preview when the pattern + actors are settled.
  useEffect(() => {
    if (!open || !canPreview) {
      setSlots([]);
      return;
    }
    const handle = setTimeout(() => {
      setPreviewing(true);
      void previewSeriesAction({
        patientId,
        therapistId,
        roomId: roomId || null,
        startsAt: new Date(startsAt),
        durationMinutes: duration,
        rule: {
          frequency: 'WEEKLY',
          interval,
          byWeekday,
          count,
        },
      })
        .then((r) => {
          if (!r.ok) {
            toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
            setSlots([]);
            return;
          }
          setSlots(
            r.data.occurrences.map((occ: SeriesPreviewOccurrence) => ({
              index: occ.index,
              startsAt: new Date(occ.startsAt),
              durationMinutes: occ.durationMinutes,
              conflicts: occ.conflicts,
              // Auto-decide KEEP for clean slots so the user only has
              // to focus on the conflicting rows.
              resolution: occ.conflicts.ok ? 'KEEP' : null,
            })),
          );
        })
        .finally(() => setPreviewing(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [
    open,
    canPreview,
    patientId,
    therapistId,
    roomId,
    startsAt,
    duration,
    interval,
    count,
    byWeekday,
    locale,
  ]);

  const applyShift = useCallback(
    async (slot: SlotState, kind: 'SHIFT_1D' | 'SHIFT_1W') => {
      const offsetMs = kind === 'SHIFT_1D' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      const shifted = new Date(slot.startsAt.getTime() + offsetMs);
      const r = await previewSeriesSlotAction({
        patientId,
        therapistId,
        startsAt: shifted.toISOString(),
        durationMinutes: slot.durationMinutes,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      setSlots((prev) =>
        prev.map((s) =>
          s.index === slot.index
            ? {
                ...s,
                startsAt: shifted,
                conflicts: r.data,
                // Only auto-accept the shift when the new slot is clean.
                // A still-conflicting shift reverts to "Resolve" so the
                // user picks again (Prompt 7b §4.4 — no silent accept).
                resolution: r.data.ok ? kind : null,
              }
            : s,
        ),
      );
    },
    [locale, patientId, therapistId],
  );

  function setSlotResolution(slot: SlotState, resolution: SeriesResolution) {
    if (resolution === 'SHIFT_1D' || resolution === 'SHIFT_1W') {
      void applyShift(slot, resolution);
      return;
    }
    setSlots((prev) => prev.map((s) => (s.index === slot.index ? { ...s, resolution } : s)));
  }

  const allResolved = slots.length > 0 && slots.every((s) => s.resolution !== null);
  const conflictCount = slots.filter((s) => !s.conflicts.ok).length;

  const overrideUsed = useMemo(() => slots.some((s) => s.resolution === 'OVERRIDE'), [slots]);

  function submit() {
    if (!allResolved) {
      toast.error(t('unresolvedError'));
      return;
    }
    if (overrideUsed && !canOverride) {
      toast.error(t('overrideNotPermitted'));
      return;
    }
    startTransition(async () => {
      const r = await createSeriesAction({
        patientId,
        therapistId,
        roomId: roomId || null,
        startsAt: new Date(startsAt),
        durationMinutes: duration,
        notes: notes || null,
        rule: {
          frequency: 'WEEKLY',
          interval,
          byWeekday,
          count,
        },
        resolutions: slots.map((s) => ({
          index: s.index,
          startsAt: s.startsAt,
          resolution: s.resolution!,
        })),
      });
      if (!r.ok) {
        const occurrenceIndex =
          typeof r.error.details?.occurrenceIndex === 'number'
            ? r.error.details.occurrenceIndex
            : null;
        if (occurrenceIndex !== null) {
          toast.error(
            t('occurrenceFailed', {
              index: String(occurrenceIndex + 1),
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
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="series-patient">{tForm('patient')}</Label>
            <select
              id="series-patient"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {locale === 'ar' ? p.fullNameAr : p.fullNameEn}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="series-therapist">{tForm('therapist')}</Label>
            <select
              id="series-therapist"
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'ar' ? c.fullNameAr : c.fullNameEn}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="series-room">{tForm('room')}</Label>
            <select
              id="series-room"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="series-duration">{tForm('duration')}</Label>
            <Input
              id="series-duration"
              type="number"
              min={5}
              max={480}
              step={15}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value || '30', 10))}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="series-starts">{tForm('startsAt')}</Label>
            <Input
              id="series-starts"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-brand-navy">{t('patternLegend')}</legend>
          <div className="flex items-center gap-2 text-sm">
            <span>{t('intervalLabel')}</span>
            <Input
              type="number"
              min={1}
              max={8}
              value={interval}
              onChange={(e) => setInterval(parseInt(e.target.value || '1', 10))}
              className="w-20"
            />
            <span>{t('intervalSuffix')}</span>
            <span className="ms-4">{t('countLabel')}</span>
            <Input
              type="number"
              min={1}
              max={52}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value || '1', 10))}
              className="w-20"
            />
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-brand-textMuted">
              {t('weekdayLegend')}
            </span>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => {
                const active = byWeekday.includes(day);
                return (
                  <button
                    type="button"
                    key={day}
                    onClick={() =>
                      setByWeekday((prev) =>
                        prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
                      )
                    }
                    className={`rounded-md border px-3 py-1 text-xs font-medium ${
                      active
                        ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
                        : 'border-brand-border bg-brand-surface text-brand-textMuted hover:bg-brand-bg'
                    }`}
                  >
                    {t(`weekdays.${day}`)}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>

        <div className="space-y-1">
          <Label htmlFor="series-notes">{tForm('notes')}</Label>
          <textarea
            id="series-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-brand-navy">{t('previewLegend')}</h3>
            <span className="text-xs text-brand-textMuted">
              {previewing
                ? '…'
                : slots.length > 0
                  ? t('previewIntro', { count: String(slots.length) })
                  : ''}
            </span>
          </div>
          <ul className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-brand-border bg-brand-bg p-2">
            {slots.map((s) => (
              <li
                key={s.index}
                className={`rounded-md border bg-brand-surface p-2 text-sm ${
                  s.conflicts.ok
                    ? 'border-brand-border'
                    : s.resolution
                      ? 'border-amber-200'
                      : 'border-red-300'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-brand-navy">
                      #{s.index + 1} · {formatDate(s.startsAt, intlLocale)} ·{' '}
                      {formatTime(s.startsAt, intlLocale)}
                    </p>
                    <p
                      className={`text-xs ${
                        s.conflicts.ok ? 'text-brand-textMuted' : 'text-red-700'
                      }`}
                    >
                      {s.conflicts.ok
                        ? t('noConflict')
                        : t('conflictCount', { count: String(s.conflicts.conflicts.length) })}
                    </p>
                  </div>
                  {!s.conflicts.ok ? (
                    <div className="flex flex-wrap gap-1">
                      <ResolutionButton
                        active={s.resolution === 'SKIP'}
                        onClick={() => setSlotResolution(s, 'SKIP')}
                      >
                        {t('resolutionSkip')}
                      </ResolutionButton>
                      <ResolutionButton
                        active={s.resolution === 'SHIFT_1D'}
                        onClick={() => setSlotResolution(s, 'SHIFT_1D')}
                      >
                        {t('resolutionShift1d')}
                      </ResolutionButton>
                      <ResolutionButton
                        active={s.resolution === 'SHIFT_1W'}
                        onClick={() => setSlotResolution(s, 'SHIFT_1W')}
                      >
                        {t('resolutionShift1w')}
                      </ResolutionButton>
                      {canOverride ? (
                        <ResolutionButton
                          variant="danger"
                          active={s.resolution === 'OVERRIDE'}
                          onClick={() => setSlotResolution(s, 'OVERRIDE')}
                        >
                          {t('resolutionOverride')}
                        </ResolutionButton>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {!s.conflicts.ok ? (
                  <ul className="mt-1 list-disc ps-5 text-xs text-brand-textMuted">
                    {s.conflicts.conflicts.map((c, i) => (
                      <li key={i}>{describeConflict(c, tConflicts, locale)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          {conflictCount > 0 && !allResolved ? (
            <p className="text-xs text-amber-800">{t('unresolvedError')}</p>
          ) : null}
        </section>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {tCommon('cancel')}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || !allResolved || (overrideUsed && !canOverride)}
          >
            {pending ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResolutionButton({
  children,
  active,
  variant,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  variant?: 'danger';
  onClick: () => void;
}) {
  const base = 'rounded-md border px-2 py-1 text-xs font-medium transition-colors';
  const palette = active
    ? variant === 'danger'
      ? 'border-red-500 bg-red-500 text-white'
      : 'border-brand-cyan bg-brand-cyan text-white'
    : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg';
  return (
    <button type="button" className={`${base} ${palette}`} onClick={onClick}>
      {children}
    </button>
  );
}

function toLocalInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hr}:${min}`;
}

type ConflictType =
  | {
      kind: 'THERAPIST_OVERLAP';
      appointment: { patient: { fullNameEn: string; fullNameAr: string }; startsAt: Date };
    }
  | {
      kind: 'PATIENT_OVERLAP';
      appointment: { therapist: { fullNameEn: string; fullNameAr: string }; startsAt: Date };
    }
  | { kind: 'THERAPIST_ON_LEAVE' }
  | { kind: 'OUTSIDE_BUSINESS_HOURS'; openTime: string; closeTime: string }
  | { kind: 'CLINIC_CLOSED_THIS_DAY' };

function describeConflict(
  c: unknown,
  t: (key: string, params?: Record<string, string>) => string,
  locale: string,
): string {
  const conflict = c as ConflictType;
  switch (conflict.kind) {
    case 'THERAPIST_OVERLAP': {
      const name =
        locale === 'ar'
          ? conflict.appointment.patient.fullNameAr
          : conflict.appointment.patient.fullNameEn;
      return t('therapistOverlap', {
        patient: name,
        time: new Date(conflict.appointment.startsAt).toISOString(),
      });
    }
    case 'PATIENT_OVERLAP': {
      const name =
        locale === 'ar'
          ? conflict.appointment.therapist.fullNameAr
          : conflict.appointment.therapist.fullNameEn;
      return t('patientOverlap', {
        therapist: name,
        time: new Date(conflict.appointment.startsAt).toISOString(),
      });
    }
    case 'THERAPIST_ON_LEAVE':
      return t('therapistOnLeave');
    case 'OUTSIDE_BUSINESS_HOURS':
      return t('outsideBusinessHours', {
        open: conflict.openTime,
        close: conflict.closeTime,
      });
    case 'CLINIC_CLOSED_THIS_DAY':
      return t('clinicClosedThisDay');
  }
}
