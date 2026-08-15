'use client';

import { CalendarDays } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

/**
 * Date field with a real calendar popup (Prompt 46 item A — QA sheet row 4).
 *
 * The native `<input type="date">` STAYS: typed entry keeps working, and on
 * phones the OS wheel picker remains the fastest path. The calendar button
 * adds what the clinic asked for on desktop — a visual picker with FAST
 * year/month navigation (dropdowns, not month-by-month paging back 40
 * years). Built from existing primitives; no new dependency (the project
 * has no date-picker library, and the stack is intentionally tight).
 *
 * The rendered grid is Gregorian by design (Master Context §7 — Hijri is a
 * display preference elsewhere, never an input calendar). Month/weekday
 * names localize through Intl for the active locale, and the layout uses
 * logical properties only, so RTL mirrors for free.
 *
 * Value contract is identical to the old text field: `YYYY-MM-DD` in the
 * form state, ISO at rest — no storage change.
 */
interface DateFieldProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
  /** Inclusive ISO bounds; also applied to the native input as min/max. */
  minIso?: string;
  maxIso?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parseIso(value: unknown): { y: number; m: number; d: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y, m, d };
}

export function DateField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  disabled,
  className,
  minIso = '1900-01-01',
  maxIso,
}: DateFieldProps<T>) {
  const locale = useLocale();
  const t = useTranslations('common.datePicker');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const resolvedMax = maxIso ?? toIso(today.getFullYear(), today.getMonth(), today.getDate());
  const minParts = parseIso(minIso)!;
  const maxParts = parseIso(resolvedMax)!;

  // Visible month/year of the grid. Re-anchored to the field value each time
  // the popup opens (see toggle below).
  const [view, setView] = useState<{ y: number; m: number }>({
    y: maxParts.y,
    m: maxParts.m,
  });

  // Close on outside interaction + Escape. The popup augments the input —
  // it must never trap focus or block typing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const monthNames = useMemo(() => {
    // ar-JO for the Levantine month names (آب, not أغسطس) — matches the
    // app's formatters in lib/format/locale.ts.
    const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-JO' : 'en-US', { month: 'long' });
    return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(Date.UTC(2024, m, 1))));
  }, [locale]);

  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-JO' : 'en-US', { weekday: 'narrow' });
    // 2024-01-07 is a Sunday; the grid is Sunday-first in both locales.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 7 + i))));
  }, [locale]);

  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = maxParts.y; y >= minParts.y; y--) list.push(y);
    return list;
  }, [minParts.y, maxParts.y]);

  const inBounds = (iso: string) => iso >= minIso && iso <= resolvedMax;

  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => {
        const openPicker = () => {
          const parsed = parseIso(field.value);
          if (parsed) setView({ y: parsed.y, m: parsed.m });
          setOpen((o) => !o);
        };
        const firstWeekday = new Date(view.y, view.m, 1).getDay(); // 0 = Sunday
        const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
        const selected = parseIso(field.value);
        return (
          <FormItem className={className}>
            <FormLabel>{label}</FormLabel>
            <div className="relative" ref={containerRef}>
              <FormControl>
                <Input
                  {...field}
                  type="date"
                  min={minIso}
                  max={resolvedMax}
                  disabled={disabled}
                  value={field.value ?? ''}
                  className="pe-10"
                />
              </FormControl>
              <button
                type="button"
                onClick={openPicker}
                disabled={disabled}
                aria-label={t('openCalendar')}
                aria-expanded={open}
                className="absolute end-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-brand-textMuted transition-colors hover:bg-brand-bg hover:text-brand-navy disabled:opacity-50"
              >
                <CalendarDays className="size-4" />
              </button>

              {open ? (
                <div
                  role="dialog"
                  aria-label={t('openCalendar')}
                  className="shadow-soft-xl absolute start-0 top-full z-50 mt-1 w-72 rounded-lg border border-brand-border bg-brand-surface p-3"
                >
                  {/* Fast year navigation — the non-negotiable for a birth
                      date: month + year dropdowns, no 40-year paging. */}
                  <div className="mb-2 flex gap-2">
                    <select
                      aria-label={t('month')}
                      value={view.m}
                      onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}
                      className="h-9 flex-1 rounded-md border border-brand-border bg-brand-surface px-2 text-sm"
                    >
                      {monthNames.map((nameLabel, m) => (
                        <option key={m} value={m}>
                          {nameLabel}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t('year')}
                      value={view.y}
                      onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))}
                      className="h-9 w-24 rounded-md border border-brand-border bg-brand-surface px-2 text-sm tabular-nums"
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-7 text-center text-xs text-brand-textMuted">
                    {weekdayNames.map((w, i) => (
                      <span key={i} className="py-1">
                        {w}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {Array.from({ length: firstWeekday }, (_, i) => (
                      <span key={`pad-${i}`} />
                    ))}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const iso = toIso(view.y, view.m, day);
                      const isSelected =
                        selected !== null &&
                        selected.y === view.y &&
                        selected.m === view.m &&
                        selected.d === day;
                      const enabled = inBounds(iso);
                      return (
                        <button
                          key={day}
                          type="button"
                          disabled={!enabled}
                          onClick={() => {
                            field.onChange(iso);
                            setOpen(false);
                          }}
                          className={`h-9 rounded-md text-sm tabular-nums transition-colors ${
                            isSelected
                              ? 'bg-brand-cyan text-white'
                              : enabled
                                ? 'text-brand-text hover:bg-brand-bg'
                                : 'cursor-not-allowed text-brand-textMuted/40'
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            {description ? <FormDescription>{description}</FormDescription> : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
