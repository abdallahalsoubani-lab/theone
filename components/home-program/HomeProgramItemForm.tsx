'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  addHomeProgramItemAction,
  updateHomeProgramItemAction,
} from '@/lib/clinical/home-program/actions';
import type { HomeProgramItemRow } from '@/lib/clinical/home-program/queries';
import type { ExerciseOption } from '@/lib/clinical/plans/exercises';

interface Props {
  patientId: string;
  exerciseOptions: ExerciseOption[];
  /** Edit mode when set. */
  initial?: HomeProgramItemRow;
  /** Called after a successful save so the parent can refresh. */
  onDone?: () => void;
}

const DAYS: ReadonlyArray<{ value: number; labelEnShort: string; labelArShort: string }> = [
  { value: 0, labelEnShort: 'Sun', labelArShort: 'أحد' },
  { value: 1, labelEnShort: 'Mon', labelArShort: 'إثن' },
  { value: 2, labelEnShort: 'Tue', labelArShort: 'ثلا' },
  { value: 3, labelEnShort: 'Wed', labelArShort: 'أرب' },
  { value: 4, labelEnShort: 'Thu', labelArShort: 'خمي' },
  { value: 5, labelEnShort: 'Fri', labelArShort: 'جمع' },
  { value: 6, labelEnShort: 'Sat', labelArShort: 'سبت' },
];

/**
 * Compact builder form. Displays inline (not a modal) inside the
 * patient's home-program edit page. The day-of-week selector is a
 * row of toggleable chips — clearer than a multi-select.
 */
export function HomeProgramItemForm({ patientId, exerciseOptions, initial, onDone }: Props) {
  const t = useTranslations('clinical.homeProgram');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [exerciseId, setExerciseId] = useState(initial?.exerciseId ?? exerciseOptions[0]?.id ?? '');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initial?.daysOfWeek ?? [1, 3, 5]);
  const [scheduledTime, setScheduledTime] = useState(initial?.scheduledTime ?? '18:00');
  const [durationMinutes, setDurationMinutes] = useState(initial?.durationMinutes ?? 15);
  const [setsReps, setSetsReps] = useState(initial?.setsReps ?? '');
  const [therapistNote, setTherapistNote] = useState(initial?.therapistNote ?? '');

  function toggleDay(d: number) {
    setDaysOfWeek((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b),
    );
  }

  function submit() {
    if (daysOfWeek.length === 0) {
      toast.error(t('errors.daysRequired'));
      return;
    }
    startTransition(async () => {
      const payload = {
        patientId,
        exerciseId,
        daysOfWeek,
        scheduledTime,
        durationMinutes,
        setsReps: setsReps || null,
        therapistNote: therapistNote || null,
      };
      const r = initial
        ? await updateHomeProgramItemAction({ id: initial.id, active: initial.active, ...payload })
        : await addHomeProgramItemAction(payload);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t(initial ? 'updatedToast' : 'addedToast'));
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-4 rounded-md border border-brand-border bg-brand-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <Label htmlFor="ex">{t('exercise')}</Label>
        <select
          id="ex"
          value={exerciseId}
          onChange={(e) => setExerciseId(e.target.value)}
          className="block w-full rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm"
          required
        >
          {exerciseOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {locale === 'ar' ? opt.nameAr : opt.nameEn}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label>{t('daysOfWeek')}</Label>
        <div className="mt-1 flex flex-wrap gap-1">
          {DAYS.map((d) => {
            const selected = daysOfWeek.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`h-9 min-w-[3rem] rounded-md border px-2 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-brand-cyan bg-brand-cyan text-white'
                    : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg'
                }`}
              >
                {locale === 'ar' ? d.labelArShort : d.labelEnShort}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="time">{t('scheduledTime')}</Label>
          <Input
            id="time"
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="dur">{t('durationMinutes')}</Label>
          <Input
            id="dur"
            type="number"
            min={1}
            max={180}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value) || 1)}
            required
          />
        </div>
        <div>
          <Label htmlFor="reps">{t('setsReps')}</Label>
          <Input
            id="reps"
            value={setsReps}
            onChange={(e) => setSetsReps(e.target.value)}
            placeholder="3 × 10"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="note">{t('therapistNote')}</Label>
        <textarea
          id="note"
          value={therapistNote}
          onChange={(e) => setTherapistNote(e.target.value)}
          rows={2}
          placeholder={t('therapistNotePlaceholder')}
          className="mt-1 block w-full rounded-md border border-brand-border bg-brand-surface p-2 text-sm"
        />
      </div>

      <div className="flex justify-end gap-2">
        {onDone ? (
          <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={pending}>
            {t('cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {initial ? t('save') : t('add')}
        </Button>
      </div>
    </form>
  );
}
