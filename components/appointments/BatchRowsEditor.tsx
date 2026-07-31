'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { SearchablePillGroup } from '@/components/ui/searchable-select';
import type { BatchRowDraft, BatchRowIssue } from '@/lib/appointments/batch-validation';
import { RESIZE_MIN_MINUTES } from '@/lib/appointments/schemas';

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
 * date · time · therapist(s) · room · duration · remove. Validation issues
 * and server conflict findings render inline under the offending row; a
 * row with either renders with a red border so the fix target is obvious.
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
}) {
  const t = useTranslations('calendar.series');
  const tForm = useTranslations('appointments.form');
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_1fr_auto] sm:items-end">
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
              <div className="space-y-1">
                <label className="text-xs text-brand-textMuted">{t('colRoom')}</label>
                <select
                  value={row.roomId}
                  onChange={(e) => onChange(i, { roomId: e.target.value })}
                  aria-label={`${t('colRoom')} ${i + 1}`}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{tForm('roomPlaceholder')}</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
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
            <div className="mt-2 space-y-1">
              <label className="text-xs text-brand-textMuted">{t('colTherapists')}</label>
              <SearchablePillGroup
                options={clinicians.map((c) => ({
                  id: c.id,
                  label: locale === 'ar' ? c.fullNameAr : c.fullNameEn,
                  sublabel: locale === 'ar' ? c.fullNameEn : c.fullNameAr,
                }))}
                selectedIds={row.therapistIds}
                onToggle={(id) =>
                  onChange(i, {
                    therapistIds: row.therapistIds.includes(id)
                      ? row.therapistIds.filter((x) => x !== id)
                      : [...row.therapistIds, id],
                  })
                }
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
