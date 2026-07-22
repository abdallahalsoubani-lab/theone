import type { ClinicianSummary } from './clinicianSummary';

/**
 * CSV serialization for the clinician summary export (Prompt 40 §3.4). Pure
 * (unit-testable); the route prepends the UTF-8 BOM so Excel decodes Arabic
 * correctly — same convention as the audit CSV export (Prompt 15).
 */

export interface ClinicianSummaryCsvLabels {
  clinician: string;
  role: string;
  completed: string;
  booked: string;
  cancelled: string;
  noShow: string;
  totalsRow: string;
}

function esc(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildClinicianSummaryCsv(
  summary: ClinicianSummary,
  labels: ClinicianSummaryCsvLabels,
  locale: 'en' | 'ar',
): string {
  const header = [
    labels.clinician,
    labels.role,
    labels.completed,
    labels.booked,
    labels.cancelled,
    labels.noShow,
  ];
  const lines = [header.map(esc).join(',')];
  for (const r of summary.rows) {
    const name = locale === 'ar' ? r.fullNameAr || r.fullNameEn : r.fullNameEn;
    lines.push([esc(name), esc(r.role), r.completed, r.booked, r.cancelled, r.noShow].join(','));
  }
  const t = summary.totals;
  lines.push([esc(labels.totalsRow), '', t.completed, t.booked, t.cancelled, t.noShow].join(','));
  return lines.join('\n') + '\n';
}
