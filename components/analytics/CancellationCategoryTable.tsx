import { useTranslations } from 'next-intl';

import type { CancellationCategoryRow } from '@/lib/analytics/queries';

interface Props {
  rows: CancellationCategoryRow[];
}

/**
 * Plain table rather than a chart — when categories are sparse a
 * tabular view scans faster than a bar chart with a stretched axis.
 */
export function CancellationCategoryTable({ rows }: Props) {
  const t = useTranslations('analytics.cancellations');
  const tCategories = useTranslations('calendar.cancel.categories');
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  return (
    <div className="rounded-lg border border-brand-border bg-brand-surface p-4">
      <h3 className="mb-2 text-sm font-medium text-brand-navy">{t('title')}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-brand-textMuted">{t('empty')}</p>
      ) : (
        <table className="min-w-full divide-y divide-brand-border text-sm">
          <thead className="text-xs uppercase tracking-wide text-brand-textMuted">
            <tr>
              <th className="px-2 py-1 text-start">{t('category')}</th>
              <th className="px-2 py-1 text-end">{t('count')}</th>
              <th className="px-2 py-1 text-end">{t('share')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {rows.map((r) => {
              const share = total > 0 ? Math.round((r.count / total) * 100) : 0;
              return (
                <tr key={r.category}>
                  <td className="px-2 py-1">{tCategories(r.category)}</td>
                  <td className="px-2 py-1 text-end font-medium">{r.count}</td>
                  <td className="px-2 py-1 text-end text-brand-textMuted">{share}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
