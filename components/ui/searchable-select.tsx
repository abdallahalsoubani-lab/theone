'use client';

import { ChevronDown, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import { filterPickerOptions, partitionPillOptions, type PickerOption } from '@/lib/pickers/filter';
import { cn } from '@/lib/utils';

export type { PickerOption } from '@/lib/pickers/filter';

/**
 * Searchable pickers (Prompt 47 — clinic request): every patient/clinician
 * list-picker filters by typing. Two shapes share one filtering brain
 * (lib/pickers/filter.ts):
 *
 *   - `SearchableSelect`  — single-select combobox replacing native
 *     `<select>`s. Closed: a button showing the selection. Open: a search
 *     input + filtered listbox with keyboard navigation.
 *   - `SearchablePillGroup` — the P20/P30 multi-select pill walls with a
 *     filter input on top. Selected pills stay visible while filtering.
 *
 * Bilingual by data, not logic: callers pass `label` (viewer locale) and
 * `sublabel` (other script, + phone only where the viewer may see it), and
 * both are searched. RTL-correct via logical properties (`text-start`,
 * `ps/pe`) and inherited direction — no LTR-only positioning.
 */

export function SearchableSelect({
  id,
  value,
  onChange,
  options,
  emptyValueLabel = '—',
  clearable = true,
  disabled = false,
  className,
}: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  options: PickerOption[];
  /** Shown when nothing is selected — also the label of the clear row. */
  emptyValueLabel?: string;
  /** Offer a "none" row that resets the value to ''. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('pickers');
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;
  const matches = filterPickerOptions(options, query).filter((o) => !o.disabled);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const pick = (nextId: string) => {
    onChange(nextId);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = matches[activeIndex];
      if (target) pick(target.id);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn('truncate text-start', !selected && 'text-brand-textMuted')}>
          {selected ? selected.label : emptyValueLabel}
        </span>
        <ChevronDown className="size-4 flex-none text-brand-textMuted" aria-hidden />
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-brand-border bg-brand-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-brand-border px-3">
            <Search className="size-4 flex-none text-brand-textMuted" aria-hidden />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('searchPlaceholder')}
              aria-autocomplete="list"
              aria-controls={listId}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-brand-textMuted"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('clearSearch')}
                className="text-brand-textMuted hover:text-brand-navy"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {clearable && !query ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === ''}
                  onClick={() => pick('')}
                  className="w-full rounded px-3 py-2 text-start text-sm text-brand-textMuted hover:bg-brand-bg"
                >
                  {emptyValueLabel}
                </button>
              </li>
            ) : null}
            {matches.length === 0 ? (
              <li className="px-3 py-2 text-sm text-brand-textMuted">{t('noResults')}</li>
            ) : (
              matches.map((o, i) => (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.id === value}
                    onClick={() => pick(o.id)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 rounded px-3 py-2 text-start text-sm',
                      i === activeIndex ? 'bg-brand-cyan/10 text-brand-navy' : 'text-brand-text',
                      o.id === value && 'font-medium text-brand-navy',
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.sublabel ? (
                      <span className="truncate text-xs text-brand-textMuted" dir="auto">
                        {o.sublabel}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function SearchablePillGroup({
  options,
  selectedIds,
  onToggle,
  tone = 'cyan',
  /** Hide the filter input for tiny lists where it would be noise. */
  searchThreshold = 7,
}: {
  options: PickerOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  tone?: 'cyan' | 'teal';
  searchThreshold?: number;
}) {
  const t = useTranslations('pickers');
  const [query, setQuery] = useState('');
  const { selected, unselectedMatches } = partitionPillOptions(options, selectedIds, query);
  const showSearch = options.length > searchThreshold;

  const pill = (o: PickerOption, isSelected: boolean) => (
    <button
      key={o.id}
      type="button"
      aria-pressed={isSelected}
      onClick={() => onToggle(o.id)}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium transition-colors',
        isSelected
          ? tone === 'teal'
            ? 'bg-brand-teal text-white'
            : 'bg-brand-cyan text-white'
          : tone === 'teal'
            ? 'bg-brand-bg text-brand-navy hover:bg-brand-teal/10'
            : 'bg-brand-bg text-brand-navy hover:bg-brand-cyan/10',
      )}
    >
      {o.label}
    </button>
  );

  return (
    <div className="rounded-md border border-input bg-background p-2">
      {showSearch ? (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-brand-border bg-brand-surface px-2">
          <Search className="size-3.5 flex-none text-brand-textMuted" aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-brand-textMuted"
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {/* Selections never disappear while filtering (P20/P30 rule). */}
        {selected.map((o) => pill(o, true))}
        {unselectedMatches.map((o) => pill(o, false))}
        {selected.length === 0 && unselectedMatches.length === 0 ? (
          <span className="px-1 py-0.5 text-sm text-brand-textMuted">{t('noResults')}</span>
        ) : null}
      </div>
    </div>
  );
}
