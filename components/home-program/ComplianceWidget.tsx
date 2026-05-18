import { getTranslations } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import type { ComplianceResult } from '@/lib/clinical/compliance/calculate';

interface Props {
  sevenDay: ComplianceResult;
  thirtyDay: ComplianceResult;
  streak: number;
}

/**
 * Clinician-facing compliance summary shown on the patient file Home
 * Program tab. Stat row above the per-item list (Prompt 10 §4.8.2).
 */
export async function ComplianceWidget({ sevenDay, thirtyDay, streak }: Props) {
  const t = await getTranslations('clinical.compliance');

  function ratePct(rate: number | null): string {
    return rate == null ? '—' : `${Math.round(rate * 100)}%`;
  }
  function tone(rate: number | null): 'default' | 'outline' | 'destructive' | 'muted' {
    if (rate == null) return 'muted';
    if (rate >= 0.75) return 'default';
    if (rate >= 0.5) return 'outline';
    return 'destructive';
  }

  return (
    <section className="grid gap-3 sm:grid-cols-4">
      <Stat label={t('sevenDay')} value={ratePct(sevenDay.rate)} tone={tone(sevenDay.rate)} />
      <Stat label={t('thirtyDay')} value={ratePct(thirtyDay.rate)} tone={tone(thirtyDay.rate)} />
      <Stat label={t('streak')} value={`${streak}`} />
      <Stat
        label={t('overdue')}
        value={`${sevenDay.overdue}`}
        tone={sevenDay.overdue > 0 ? 'destructive' : 'muted'}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  tone = 'muted',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'outline' | 'destructive' | 'muted';
}) {
  return (
    <div className="rounded-md border border-brand-border bg-brand-surface p-3">
      <p className="text-xs uppercase tracking-wide text-brand-textMuted">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-2xl font-medium text-brand-navy">{value}</p>
        <Badge variant={tone}>{label}</Badge>
      </div>
    </div>
  );
}
