'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { resolveInboxItemAction } from '@/lib/inbox/actions';
import type { InboxListRow } from '@/lib/inbox/queries';

interface Props {
  rows: InboxListRow[];
}

/**
 * Secretary inbox table.
 *
 * Per row: type badge, patient (linked to file), appointment (linked to
 * calendar if any), received timestamp, message preview, "Resolve" action.
 * "Open in calendar" / "Reschedule" surface as plain links — Prompt 7b
 * replaces them with embedded actions, but a link works in v1 and avoids
 * adding another modal stack here.
 */
export function InboxTable({ rows }: Props) {
  const t = useTranslations('secretary.inbox');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleResolve = (id: string) =>
    startTransition(async () => {
      const r = await resolveInboxItemAction({ id });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t('resolvedToast'));
      router.refresh();
    });

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
        {t('empty')}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-brand-border bg-brand-surface">
      <table className="min-w-full text-sm">
        <thead className="border-b border-brand-border bg-brand-bg">
          <tr className="text-start">
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">{t('type')}</th>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
              {t('patient')}
            </th>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
              {t('preview')}
            </th>
            <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
              {t('received')}
            </th>
            <th className="px-3 py-2 text-end font-medium text-brand-textMuted">{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const patientName =
              row.patient && (locale === 'ar' ? row.patient.fullNameAr : row.patient.fullNameEn);
            return (
              <tr
                key={row.id}
                className="border-b border-brand-border last:border-0 hover:bg-brand-bg/50"
              >
                <td className="px-3 py-3 align-top">
                  <TypeBadge type={row.type} />
                </td>
                <td className="px-3 py-3 align-top">
                  {row.patient ? (
                    <div className="flex flex-col">
                      <Link
                        href={`/secretary/patients/${row.patient.id}`}
                        className="font-medium text-brand-navy hover:underline"
                      >
                        {patientName}
                      </Link>
                      <span className="text-xs text-brand-textMuted">{row.patient.phone}</span>
                    </div>
                  ) : (
                    <span className="text-brand-textMuted">{t('unknownSender')}</span>
                  )}
                </td>
                <td className="max-w-md px-3 py-3 align-top">
                  <div className="line-clamp-2 text-brand-text">
                    {row.note ?? row.message?.body ?? ''}
                  </div>
                  {row.appointment ? (
                    <Link
                      href="/secretary/calendar"
                      className="mt-1 inline-block text-xs text-brand-cyan hover:underline"
                    >
                      {t('openAppointment')}
                    </Link>
                  ) : null}
                </td>
                <td className="px-3 py-3 align-top text-brand-textMuted">
                  {row.createdAt.toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                </td>
                <td className="px-3 py-3 text-end align-top">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => handleResolve(row.id)}
                  >
                    {t('resolve')}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TypeBadge({ type }: { type: InboxListRow['type'] }) {
  const t = useTranslations('secretary.inbox.types');
  switch (type) {
    case 'INBOUND_RESCHEDULE_REQUEST':
      return <Badge variant="outline">{t('reschedule')}</Badge>;
    case 'INBOUND_CANCEL_REQUEST':
      return <Badge variant="destructive">{t('cancel')}</Badge>;
    case 'INBOUND_UNKNOWN':
      return <Badge variant="muted">{t('unknown')}</Badge>;
    case 'OUTBOUND_DELIVERY_FAILED':
      return <Badge variant="destructive">{t('deliveryFailed')}</Badge>;
    default:
      return <Badge variant="muted">{type}</Badge>;
  }
}
