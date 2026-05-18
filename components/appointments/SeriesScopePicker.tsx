'use client';

import { useTranslations } from 'next-intl';

import type { SeriesEditMode } from '@/lib/appointments/schemas';

interface Props {
  value: SeriesEditMode;
  onChange: (mode: SeriesEditMode) => void;
  /** Hide the FOLLOWING / ALL options. Used when the appointment has
   *  no `seriesId` — the caller renders nothing and forces ONE. */
  disabled?: boolean;
}

/**
 * Inline radio group for the Prompt 7b §4.7 series-edit prompt.
 * Three options always visible: ONE / FOLLOWING / ALL. The selected
 * value is passed back to the parent which then includes it in the
 * eventual action call.
 */
export function SeriesScopePicker({ value, onChange, disabled }: Props) {
  const t = useTranslations('calendar.seriesScope');
  const modes: SeriesEditMode[] = ['ONE', 'FOLLOWING', 'ALL'];
  return (
    <fieldset className="space-y-1" disabled={disabled}>
      <legend className="text-xs uppercase tracking-wide text-brand-textMuted">
        {t('legend')}
      </legend>
      <div className="space-y-1">
        {modes.map((m) => (
          <label
            key={m}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
              value === m
                ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
                : 'border-brand-border bg-brand-surface text-brand-text hover:bg-brand-bg'
            }`}
          >
            <input
              type="radio"
              name="series-scope"
              value={m}
              checked={value === m}
              onChange={() => onChange(m)}
            />
            <span>{t(m)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
