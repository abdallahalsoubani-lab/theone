'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { CalendarAppointment } from '@/lib/appointments/queries';
import { formatPhone } from '@/lib/format/phone';

import { appointmentTooltipModel, hoverCapable } from './appointmentTooltipModel';

/** True only on hover-capable fine-pointer devices (decision أ — Prompt 56).
 *  Resolved in an effect so SSR + touch devices render plain children. */
function useHoverCapableEnv(): boolean {
  const [capable, setCapable] = useState(false);
  useEffect(() => {
    setCapable(
      hoverCapable(
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia.bind(window)
          : undefined,
      ),
    );
  }, []);
  return capable;
}

/**
 * Rich hover tooltip for calendar appointment cards (Prompt 56). Content is
 * built ONLY from the event payload (zero extra queries; phone renders only
 * where the viewer's P15-shaped feed carried it). Controlled `open` so the
 * tooltip also dismisses on any scroll; Radix itself closes it on
 * pointer-down (drag start / click) and Escape, and the provider in
 * SecretaryCalendar sets the ~450ms show delay with no sweep skip.
 */
export function AppointmentTooltip({
  appointment,
  children,
}: {
  appointment: CalendarAppointment;
  children: ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations('appointments');
  const canHover = useHoverCapableEnv();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, { capture: true });
    return () => window.removeEventListener('scroll', close, { capture: true });
  }, [open]);

  // Touch / no-hover environments: the card renders untouched and tap keeps
  // opening the detail panel exactly as before.
  if (!canHover) return <>{children}</>;

  const m = appointmentTooltipModel(appointment, locale);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const sep = locale === 'ar' ? '، ' : ', ';

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" align="center" collisionPadding={8} dir={dir} className="max-w-xs">
        <div className="space-y-1.5">
          <div>
            <div className="text-[13px] font-semibold leading-tight text-brand-navy">
              {m.primary}
            </div>
            {m.secondary ? (
              <div className="text-[11px] text-brand-textMuted">{m.secondary}</div>
            ) : null}
            {m.groupMembers.length > 0 ? (
              <div className="text-[11px] text-brand-textMuted">{m.groupMembers.join(sep)}</div>
            ) : null}
          </div>

          <div className="font-medium tabular-nums">
            <span dir="ltr">{m.timeRange}</span>
            {' · '}
            {t('tooltip.durationMinutes', { minutes: m.durationMinutes })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-brand-blue/10 px-1.5 py-px text-[10px] font-medium text-brand-blue ring-1 ring-inset ring-brand-blue/20">
              {t(`form.${m.typeKey}`)}
            </span>
            <span className="rounded-full bg-brand-teal/10 px-1.5 py-px text-[10px] font-medium text-brand-teal ring-1 ring-inset ring-brand-teal/20">
              {t(`status.${m.statusKey}`)}
            </span>
          </div>

          {m.therapists.length > 0 ? (
            <div>
              <span className="text-brand-textMuted">{t('form.therapists')}: </span>
              {m.therapists.join(sep)}
            </div>
          ) : null}

          {m.room ? (
            <div>
              <span className="text-brand-textMuted">{t('form.room')}: </span>
              {m.room}
            </div>
          ) : null}

          {m.phone ? (
            <div>
              <span className="text-brand-textMuted">{t('tooltip.phone')}: </span>
              <span dir="ltr" className="font-mono">
                {formatPhone(m.phone)}
              </span>
            </div>
          ) : null}

          {m.note ? (
            <div className="whitespace-pre-wrap break-words border-t border-brand-border pt-1.5">
              {m.note}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
