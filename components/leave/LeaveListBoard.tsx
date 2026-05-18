'use client';

import { LeaveStatus } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { RequestLeaveDialog } from '@/components/leave/RequestLeaveDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format/date';
import type { LeaveRow } from '@/lib/leave/queries';

interface Props {
  rows: LeaveRow[];
  canRequest: boolean;
}

/**
 * Staff-facing leave list. Shows the user's own leaves with status,
 * date range, type, and approval metadata. A small "Request leave"
 * button on top opens the modal.
 */
export function LeaveListBoard({ rows, canRequest }: Props) {
  const t = useTranslations('leave');
  const tStatus = useTranslations('leave.status');
  const tType = useTranslations('leave.types');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-brand-navy">{t('myLeavesTitle')}</h1>
          <p className="text-sm text-brand-textMuted">{t('myLeavesSubtitle')}</p>
        </div>
        {canRequest ? (
          <Button type="button" onClick={() => setOpen(true)}>
            {t('requestButton')}
          </Button>
        ) : null}
      </header>

      {rows.length === 0 ? (
        <p className="rounded-md border border-brand-border bg-brand-bg px-4 py-3 text-sm text-brand-textMuted">
          {t('empty.mine')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-brand-border">
          <table className="min-w-full divide-y divide-brand-border text-sm">
            <thead className="bg-brand-bg text-xs uppercase tracking-wide text-brand-textMuted">
              <tr>
                <th className="px-3 py-2 text-start">{t('columns.type')}</th>
                <th className="px-3 py-2 text-start">{t('columns.range')}</th>
                <th className="px-3 py-2 text-start">{t('columns.reason')}</th>
                <th className="px-3 py-2 text-start">{t('columns.status')}</th>
                <th className="px-3 py-2 text-start">{t('columns.approvedBy')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border bg-brand-surface">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{tType(r.leaveType)}</td>
                  <td className="px-3 py-2">
                    {formatDate(r.startDate, intlLocale)} – {formatDate(r.endDate, intlLocale)}
                  </td>
                  <td className="px-3 py-2 text-brand-textMuted">{r.reason ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(r.status)}>{tStatus(r.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-brand-textMuted">
                    {locale === 'ar'
                      ? (r.approvedByFullNameAr ?? '—')
                      : (r.approvedByFullNameEn ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RequestLeaveDialog open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

function statusVariant(s: LeaveStatus): 'cyan' | 'muted' | 'destructive' {
  switch (s) {
    case LeaveStatus.APPROVED:
      return 'cyan';
    case LeaveStatus.REJECTED:
      return 'destructive';
    default:
      return 'muted';
  }
}
