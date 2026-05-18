'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resendMessageAction } from '@/lib/admin/whatsapp/actions';
import type { MessageListRow } from '@/lib/admin/whatsapp/queries';

interface Props {
  rows: MessageListRow[];
  initialFilters: { direction: string; status: string; phone: string };
}

export function MessagesTable({ rows, initialFilters }: Props) {
  const t = useTranslations('admin.whatsapp');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`?${params.toString()}`);
  }

  function handleResend(id: string) {
    startTransition(async () => {
      const r = await resendMessageAction(id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(t('resendQueuedToast'));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-brand-border bg-brand-surface p-3">
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('direction')}
          <select
            defaultValue={initialFilters.direction}
            onChange={(e) => setFilter('direction', e.target.value)}
            className="h-8 rounded-md border border-brand-border bg-brand-surface px-2 text-sm"
          >
            <option value="">—</option>
            <option value="OUTBOUND">OUTBOUND</option>
            <option value="INBOUND">INBOUND</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('status')}
          <select
            defaultValue={initialFilters.status}
            onChange={(e) => setFilter('status', e.target.value)}
            className="h-8 rounded-md border border-brand-border bg-brand-surface px-2 text-sm"
          >
            <option value="">—</option>
            <option value="QUEUED">QUEUED</option>
            <option value="SENT">SENT</option>
            <option value="DELIVERED">DELIVERED</option>
            <option value="READ">READ</option>
            <option value="FAILED">FAILED</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('phone')}
          <Input
            placeholder="+962…"
            defaultValue={initialFilters.phone}
            onBlur={(e) => setFilter('phone', e.target.value)}
            className="h-8 w-48 text-sm"
          />
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
          {t('emptyMessages')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-brand-border bg-brand-surface">
          <table className="min-w-full text-sm">
            <thead className="border-b border-brand-border bg-brand-bg">
              <tr>
                <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
                  {t('sentAt')}
                </th>
                <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
                  {t('direction')}
                </th>
                <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
                  {t('status')}
                </th>
                <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
                  {t('recipient')}
                </th>
                <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
                  {t('template')}
                </th>
                <th className="px-3 py-2 text-start font-medium text-brand-textMuted">
                  {t('body')}
                </th>
                <th className="px-3 py-2 text-end font-medium text-brand-textMuted">
                  {t('actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-brand-border align-top last:border-0">
                  <td className="px-3 py-3 text-xs text-brand-textMuted">
                    {row.sentAt.toLocaleString(locale === 'ar' ? 'ar' : 'en')}
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant={row.direction === 'INBOUND' ? 'outline' : 'muted'}>
                      {row.direction}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={row.status} />
                    {row.failureReason ? (
                      <div className="mt-1 text-xs text-brand-textMuted">{row.failureReason}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-mono text-xs text-brand-textMuted">
                      {row.recipientPhone}
                    </div>
                    {row.recipientName ? (
                      <div className="text-xs text-brand-text">{row.recipientName}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-xs text-brand-textMuted">
                    {row.templateName ? (
                      <span className="font-mono">
                        {row.templateName}/{row.templateLanguage}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="max-w-md px-3 py-3 text-xs">
                    <div className="line-clamp-2">{row.body}</div>
                    {row.providerMessageId ? (
                      <div className="mt-1 font-mono text-[10px] text-brand-textMuted">
                        {row.providerMessageId}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-end">
                    {row.direction === 'OUTBOUND' && row.status === 'FAILED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || row.resendCount >= 3}
                        onClick={() => handleResend(row.id)}
                      >
                        {t('resend')} {row.resendCount > 0 ? `(${row.resendCount}/3)` : null}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'DELIVERED':
    case 'READ':
      return <Badge variant="default">{status}</Badge>;
    case 'SENT':
    case 'QUEUED':
      return <Badge variant="outline">{status}</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">{status}</Badge>;
    default:
      return <Badge variant="muted">{status}</Badge>;
  }
}
