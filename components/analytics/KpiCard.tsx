interface Props {
  label: string;
  value: string;
  hint?: string;
}

/**
 * Headline stat for the dashboard KPI row. Plain numbers — no charts —
 * so the eye lands on the most important numbers first.
 */
export function KpiCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <p className="text-xs uppercase tracking-wide text-brand-textMuted">{label}</p>
      <p className="mt-1 text-3xl font-medium text-brand-navy">{value}</p>
      {hint ? <p className="mt-1 text-xs text-brand-textMuted">{hint}</p> : null}
    </div>
  );
}
