'use client';

import { Check } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { statusCardStyle, type AppointmentStatus, type Tint } from '@/lib/calendar/appearance';
import type { LayoutBox } from '@/lib/calendar/layout';
import { formatTime } from '@/lib/format/date';

/**
 * A single appointment block in the custom day view (Custom Calendar Phase 1).
 *
 * Positioned absolutely: vertical (top/height px) from geometry, horizontal
 * (inline-start/size %) from the overlap layout. Uses LOGICAL inset/size
 * properties so it mirrors under RTL with no per-locale overrides.
 *
 * Read-only this phase — no click/drag handlers (Phases 2–3). Never renders a
 * phone number (Prompt 15 privacy); the calendar data shape carries none.
 */
export interface CardModel {
  id: string;
  patientNameEn: string;
  patientNameAr: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  checkedIn: boolean;
}

interface Props {
  card: CardModel;
  box: LayoutBox;
  topPx: number;
  heightPx: number;
  tint: Tint;
}

export function AppointmentCard({ card, box, topPx, heightPx, tint }: Props) {
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const tArrivals = useTranslations('arrivals');
  const style = statusCardStyle(card.status, tint);
  const name = intlLocale === 'ar' ? card.patientNameAr : card.patientNameEn;

  // Small inset between side-by-side cards so borders don't touch.
  const GAP = 0.6; // %
  return (
    <div
      className="shadow-xs absolute overflow-hidden rounded-lg border px-1.5 py-1 text-xs leading-tight"
      style={{
        insetBlockStart: `${topPx}px`,
        blockSize: `${heightPx}px`,
        insetInlineStart: `calc(${box.leftFraction * 100}% + ${GAP}%)`,
        inlineSize: `calc(${box.widthFraction * 100}% - ${GAP * 2}%)`,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        color: style.muted ? 'var(--brand-text-muted)' : 'var(--brand-navy)',
      }}
    >
      <div className="flex items-center gap-1">
        {card.checkedIn ? (
          <span
            className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-brand-cyan text-white"
            aria-label={tArrivals('arrivedAt')}
            title={tArrivals('arrivedAt')}
          >
            <Check className="size-2.5" aria-hidden />
          </span>
        ) : null}
        <span
          className="truncate font-medium"
          style={style.strikethrough ? { textDecoration: 'line-through' } : undefined}
        >
          {name}
        </span>
      </div>
      <div className="truncate text-[0.68rem] text-brand-textMuted">
        {formatTime(card.startsAt, intlLocale)} – {formatTime(card.endsAt, intlLocale)}
      </div>
    </div>
  );
}
