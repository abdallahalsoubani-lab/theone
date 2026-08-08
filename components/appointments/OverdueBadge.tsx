'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { minutesOverdue } from '@/lib/appointments/session-timing';

/** How often the badge re-reads the clock. A minute-resolution badge does not
 *  need to tick faster, and this is a display concern only — no fetching. */
const TICK_MS = 30_000;

/**
 * "Overdue +Nm" for a session still running past its scheduled end
 * (PT-B3 item 1). Sessions are never closed automatically — a physiotherapy
 * session can legitimately run long, and recording it as finished on time
 * would falsify the record — so the desk needs to SEE the over-run and decide.
 *
 * Text carries the meaning; the amber tint only reinforces it (the badge is
 * never colour-alone). The clock starts on mount rather than during render so
 * the server and client markup agree, then ticks so the badge appears as time
 * passes even on a screen nobody is touching.
 */
export function OverdueBadge({
  startsAt,
  durationMinutes,
  className,
}: {
  /** The appointment's true start instant (ISO string or Date). */
  startsAt: string | Date;
  durationMinutes: number;
  className?: string;
}) {
  const t = useTranslations('appointments.status');
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;
  const over = minutesOverdue(
    now,
    typeof startsAt === 'string' ? new Date(startsAt) : startsAt,
    durationMinutes,
  );
  if (over <= 0) return null;

  return (
    <Badge variant="amber" className={`tabular-nums ${className ?? ''}`}>
      {t('overdue', { minutes: over })}
    </Badge>
  );
}
