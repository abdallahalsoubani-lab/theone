'use client';

import { ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format/date';
import { patientDisplayName } from '@/lib/format/patientName';
import type { OutboxRow } from '@/lib/whatsapp/dispatch/queries';

/**
 * Collapsed last-24h activity (P48 §4.4) — confidence view: what left, what
 * failed, what got superseded/excluded. (The SAFETY_EXCEPTION label is gone
 * with the exception itself — owner order, 19 Aug 2026.)
 */
export function OutboxRecent({ rows }: { rows: OutboxRow[] }) {
  const t = useTranslations('admin.outbox');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-md border border-brand-border bg-brand-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 p-4 text-start"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-brand-navy">
          {t('recentHeading', { count: rows.length })}
        </span>
        <ChevronDown
          className={`size-4 text-brand-textMuted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open ? (
        rows.length === 0 ? (
          <p className="border-t border-brand-border p-4 text-sm text-brand-textMuted">
            {t('recentEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-brand-border">
            <table className="w-full text-sm">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-brand-border first:border-t-0">
                    <td className="p-2 font-medium text-brand-navy">
                      {patientDisplayName(r.patientNameEn, r.patientNameAr)}
                    </td>
                    <td className="p-2 text-xs text-brand-textMuted">{t(`types.${r.type}`)}</td>
                    <td className="whitespace-nowrap p-2 text-xs tabular-nums text-brand-textMuted">
                      {r.appointmentStartsAt
                        ? formatDateTime(r.appointmentStartsAt, intlLocale)
                        : '—'}
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={
                          r.status === 'SENT'
                            ? 'cyan'
                            : r.status === 'FAILED'
                              ? 'destructive'
                              : 'muted'
                        }
                      >
                        {t(`statuses.${r.status}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
