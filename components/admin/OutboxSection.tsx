'use client';

import type { WaDispatchType } from '@prisma/client';
import { Send, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format/date';
import { patientDisplayName } from '@/lib/format/patientName';
import { excludeOutboxAction, sendOutboxAction } from '@/lib/whatsapp/dispatch/actions';
import type { OutboxRow } from '@/lib/whatsapp/dispatch/queries';

/**
 * One outbox section (P48 §4.4): a message type's pending table with its
 * own counter and its OWN Send button, plus a per-row Exclude action.
 */
export function OutboxSection({ type, rows }: { type: WaDispatchType; rows: OutboxRow[] }) {
  const t = useTranslations('admin.outbox');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      const r = await sendOutboxAction(type);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(
        r.data.count === 0 ? t('nothingToSend') : t('sentToast', { count: r.data.count }),
      );
      router.refresh();
    });

  const exclude = (entryId: string) =>
    startTransition(async () => {
      const r = await excludeOutboxAction(entryId);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('excludedToast'));
      router.refresh();
    });

  return (
    <section className="space-y-2 rounded-md border border-brand-border bg-brand-surface p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-brand-navy">{t(`types.${type}`)}</h2>
          <Badge variant={rows.length > 0 ? 'cyan' : 'muted'}>{rows.length}</Badge>
        </div>
        <Button type="button" size="sm" disabled={pending || rows.length === 0} onClick={send}>
          <Send className="me-1.5 size-3.5" />
          {t('sendN', { count: rows.length })}
        </Button>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-brand-border bg-brand-bg p-4 text-center text-sm text-brand-textMuted">
          {t('emptySection')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-brand-textMuted">
              <tr>
                <th className="p-2 text-start font-medium">{t('colPatient')}</th>
                <th className="p-2 text-start font-medium">{t('colAppointment')}</th>
                <th className="p-2 text-start font-medium">{t('colTherapist')}</th>
                <th className="p-2 text-start font-medium">{t('colCreatedAt')}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-brand-border">
                  <td className="p-2">
                    <span className="font-medium text-brand-navy">
                      {patientDisplayName(r.patientNameEn, r.patientNameAr)}
                    </span>
                    {r.patientPhone ? (
                      <span className="ms-2 text-xs text-brand-textMuted" dir="ltr">
                        {r.patientPhone}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap p-2 tabular-nums">
                    {r.appointmentStartsAt
                      ? formatDateTime(r.appointmentStartsAt, intlLocale)
                      : '—'}
                  </td>
                  <td className="p-2">
                    {(intlLocale === 'ar' ? r.therapistsAr : r.therapistsEn).join(
                      intlLocale === 'ar' ? '، ' : ', ',
                    ) || '—'}
                  </td>
                  <td className="whitespace-nowrap p-2 text-xs text-brand-textMuted">
                    {formatDateTime(r.createdAt, intlLocale)}
                  </td>
                  <td className="p-2 text-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => exclude(r.id)}
                    >
                      <X className="me-1 size-3.5" />
                      {t('exclude')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
