import { Download } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { getClinicianSummary } from '@/lib/reports/clinicianSummary';
import type { ResolvedReportRange } from '@/lib/reports/params';

/**
 * Clinician sessions summary (Prompt 40) — shared by the Admin and Doctor
 * routes (each wrapper enforces `reports.clinician_summary` and passes its
 * own basePath for the preset links). Server-rendered; the range lives in
 * the URL (searchParams), matching the app's durable-filter convention.
 * Clinician-level aggregates only — no patient PII on this surface.
 */
export async function ClinicianSummaryReport({
  range,
  basePath,
  locale,
}: {
  range: ResolvedReportRange;
  basePath: string;
  locale: 'en' | 'ar';
}) {
  const t = await getTranslations('reports.clinicianSummary');
  const { rows, totals } = await getClinicianSummary({ start: range.start, end: range.end });

  const presets = [
    { key: 'today' as const, label: t('presetToday') },
    { key: 'week' as const, label: t('presetWeek') },
    { key: 'month' as const, label: t('presetMonth') },
  ];
  const exportHref = `/api/v1/reports/clinician-summary?from=${range.fromKey}&to=${range.toKey}&locale=${locale}`;

  return (
    <section className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
          <p className="text-sm text-brand-textMuted">
            {t('rangeLabel', { from: range.fromKey, to: range.toKey })}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={exportHref}>
            <Download className="me-2 size-4" />
            {t('exportCsv')}
          </a>
        </Button>
      </div>

      {/* Preset cards + free range (GET form keeps the state in the URL). */}
      <div className="flex flex-wrap items-end gap-2">
        {presets.map((p) => (
          <Button
            key={p.key}
            asChild
            size="sm"
            variant={range.scope === p.key ? 'default' : 'outline'}
          >
            <Link href={`${basePath}?scope=${p.key}` as `/${string}`}>{p.label}</Link>
          </Button>
        ))}
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
            {t('from')}
            <input
              type="date"
              name="from"
              defaultValue={range.scope === 'custom' ? range.fromKey : ''}
              className="rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm text-brand-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
            {t('to')}
            <input
              type="date"
              name="to"
              defaultValue={range.scope === 'custom' ? range.toKey : ''}
              className="rounded-md border border-brand-border bg-brand-surface px-2 py-1.5 text-sm text-brand-text"
            />
          </label>
          <Button type="submit" size="sm" variant="outline">
            {t('apply')}
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-brand-border bg-brand-bg p-6 text-center text-sm text-brand-textMuted">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-brand-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-bg text-xs text-brand-textMuted">
              <tr>
                <th className="p-2 text-start font-medium">{t('colClinician')}</th>
                <th className="p-2 text-start font-medium">{t('colCompleted')}</th>
                <th className="p-2 text-start font-medium">{t('colBooked')}</th>
                <th className="p-2 text-start font-medium">{t('colCancelled')}</th>
                <th className="p-2 text-start font-medium">{t('colNoShow')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.clinicianId} className="border-t border-brand-border">
                  <td className="p-2">
                    <span className="font-medium text-brand-navy">
                      {locale === 'ar' ? r.fullNameAr || r.fullNameEn : r.fullNameEn}
                    </span>{' '}
                    <Badge variant="muted">
                      {r.role === 'DOCTOR' ? t('roleDoctor') : t('roleTherapist')}
                    </Badge>
                  </td>
                  <td className="p-2 tabular-nums">{r.completed}</td>
                  <td className="p-2 tabular-nums">{r.booked}</td>
                  <td className="p-2 tabular-nums">{r.cancelled}</td>
                  <td className="p-2 tabular-nums">{r.noShow}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-brand-border bg-brand-bg font-medium text-brand-navy">
                <td className="p-2">{t('totalsRow')}</td>
                <td className="p-2 tabular-nums">{totals.completed}</td>
                <td className="p-2 tabular-nums">{totals.booked}</td>
                <td className="p-2 tabular-nums">{totals.cancelled}</td>
                <td className="p-2 tabular-nums">{totals.noShow}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="space-y-1 text-xs text-brand-textMuted">
        <p>{t('legendBooked')}</p>
        <p>{t('multiTherapistNote')}</p>
      </div>
    </section>
  );
}
