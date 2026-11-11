'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MAX_REPEAT_WEEKS } from '@/lib/appointments/batch-repeat';
import {
  dayKeyOfDate,
  type BatchRowDraft,
  type BatchRowIssue,
} from '@/lib/appointments/batch-validation';
import { DAY_KEYS, type DayKey } from '@/lib/appointments/conflicts-time';
import { RESIZE_MIN_MINUTES } from '@/lib/appointments/schemas';

import { BatchRowTypeFields } from './BatchRowTypeFields';
import { describeConflict } from './conflictText';

export interface BatchRowUI extends BatchRowDraft {
  /** Stable client key — rows can be removed from the middle. */
  key: string;
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

/**
 * The explicit batch rows (July 31 item 4): one row = one appointment —
 * date · time · duration · remove, then the row's type-aware group
 * (Prompt 51: booking type · room · therapists — BatchRowTypeFields).
 * Validation issues and server conflict findings render inline under the
 * offending row; a row with either renders with a red border so the fix
 * target is obvious.
 */
export function BatchRowsEditor({
  rows,
  issues,
  conflicts,
  clinicians,
  rooms,
  minDate,
  onChange,
  onRemove,
  onRepeat,
  canAddMore,
  closedDays,
}: {
  rows: BatchRowUI[];
  issues: BatchRowIssue[][];
  /** Server conflict findings per row index (submit-time sweep). */
  conflicts: Record<number, unknown[]>;
  clinicians: Clinician[];
  rooms: Room[];
  /** Today's clinic date (YYYY-MM-DD) — the picker's floor. */
  minDate: string;
  onChange: (index: number, patch: Partial<BatchRowDraft>) => void;
  onRemove: (index: number) => void;
  /** P64 #13 — expand row `index` into copies on `weekdays` for `weeks` weeks. */
  onRepeat: (index: number, weekdays: DayKey[], weeks: number) => void;
  /** False once the batch is at its row cap. */
  canAddMore: boolean;
  closedDays: ReadonlyArray<DayKey>;
}) {
  const t = useTranslations('calendar.series');
  const tDays = useTranslations('admin.settings.days');
  /** The row whose repeat panel is open (one at a time), keyed by row.key. */
  const [repeatFor, setRepeatFor] = useState<string | null>(null);
  const [repeatDays, setRepeatDays] = useState<DayKey[]>([]);
  const [repeatWeeks, setRepeatWeeks] = useState(4);

  const openRepeat = (row: BatchRowUI) => {
    if (repeatFor === row.key) {
      setRepeatFor(null);
      return;
    }
    const own = dayKeyOfDate(row.date);
    setRepeatDays(own ? [own] : []);
    setRepeatWeeks(4);
    setRepeatFor(row.key);
  };
  const tConflicts = useTranslations('appointments.conflicts');
  const locale = useLocale();

  return (
    <ul className="space-y-3">
      {rows.map((row, i) => {
        const rowIssues = issues[i] ?? [];
        const rowConflicts = conflicts[i] ?? [];
        const flagged =
          rowConflicts.length > 0 || rowIssues.some((issue) => issue !== 'incomplete');
        return (
          <li
            key={row.key}
            className={`rounded-md border p-3 ${
              flagged ? 'border-red-400 bg-red-50/50' : 'border-brand-border bg-brand-surface'
            }`}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
              <div className="space-y-1">
                <label className="text-xs text-brand-textMuted">{t('colDate')}</label>
                <Input
                  type="date"
                  value={row.date}
                  min={minDate}
                  onChange={(e) => onChange(i, { date: e.target.value })}
                  aria-label={`${t('colDate')} ${i + 1}`}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-brand-textMuted">{t('colTime')}</label>
                <Input
                  type="time"
                  value={row.time}
                  step={900}
                  onChange={(e) => onChange(i, { time: e.target.value })}
                  aria-label={`${t('colTime')} ${i + 1}`}
                  className="w-28"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-brand-textMuted">{t('colDuration')}</label>
                <Input
                  type="number"
                  min={RESIZE_MIN_MINUTES}
                  max={480}
                  step={15}
                  value={row.durationMinutes}
                  onChange={(e) =>
                    onChange(i, { durationMinutes: parseInt(e.target.value || '0', 10) })
                  }
                  aria-label={`${t('colDuration')} ${i + 1}`}
                  className="w-24"
                />
              </div>
              <div className="col-span-2 flex gap-2 sm:col-span-1">
                <button
                  type="button"
                  onClick={() => openRepeat(row)}
                  disabled={!row.date || !canAddMore}
                  aria-expanded={repeatFor === row.key}
                  title={!row.date ? t('repeat.needDate') : t('repeat.button')}
                  className="h-10 rounded-md border border-brand-border px-3 text-sm text-brand-navy hover:border-brand-cyan disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('repeat.button')}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  disabled={rows.length === 1}
                  aria-label={t('removeRow')}
                  title={t('removeRow')}
                  className="h-10 rounded-md border border-brand-border px-3 text-sm text-brand-textMuted hover:border-red-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            </div>
            {repeatFor === row.key ? (
              <div className="mt-2 space-y-2 rounded-md border border-brand-border bg-brand-bg p-3">
                <p className="text-xs text-brand-textMuted">{t('repeat.daysLabel')}</p>
                <div className="flex flex-wrap gap-1">
                  {DAY_KEYS.filter((d) => !closedDays.includes(d)).map((d) => {
                    const on = repeatDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setRepeatDays((prev) => (on ? prev.filter((x) => x !== d) : [...prev, d]))
                        }
                        className={`rounded-full border px-3 py-1 text-xs ${
                          on
                            ? 'border-brand-cyan bg-brand-cyan text-white'
                            : 'border-brand-border text-brand-text'
                        }`}
                      >
                        {tDays(d)}
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1 text-xs text-brand-textMuted">
                    <span className="block">{t('repeat.weeksLabel')}</span>
                    <Input
                      type="number"
                      min={1}
                      max={MAX_REPEAT_WEEKS}
                      value={repeatWeeks}
                      onChange={(e) => setRepeatWeeks(parseInt(e.target.value || '0', 10))}
                      className="w-20"
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      repeatDays.length === 0 || repeatWeeks < 1 || repeatWeeks > MAX_REPEAT_WEEKS
                    }
                    onClick={() => {
                      onRepeat(i, repeatDays, repeatWeeks);
                      setRepeatFor(null);
                    }}
                  >
                    {t('repeat.apply')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setRepeatFor(null)}
                  >
                    {t('repeat.cancel')}
                  </Button>
                </div>
                <p className="text-xs text-brand-textMuted">{t('repeat.hint')}</p>
              </div>
            ) : null}
            <div className="mt-2">
              <BatchRowTypeFields
                index={i}
                row={row}
                clinicians={clinicians}
                rooms={rooms}
                onChange={(patch) => onChange(i, patch)}
              />
            </div>
            {rowIssues.length > 0 || rowConflicts.length > 0 ? (
              <ul className="mt-2 list-disc ps-5 text-xs text-red-700" role="alert">
                {rowIssues.map((issue) => (
                  <li key={issue}>
                    {issue === 'durationTooShort'
                      ? t(`rowIssue.${issue}`, { min: String(RESIZE_MIN_MINUTES) })
                      : t(`rowIssue.${issue}`)}
                  </li>
                ))}
                {rowConflicts.map((c, ci) => (
                  <li key={`c-${ci}`}>{describeConflict(c, tConflicts, locale)}</li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
