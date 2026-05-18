'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { markNotificationReadAction } from '@/lib/notifications/actions';

import { NotificationItem, type NotificationView } from './NotificationItem';

interface Props {
  rows: NotificationView[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Full notifications page table — same row renderer as the bell
 * dropdown, paginated. Doubles as the "view all" destination from the
 * bell.
 */
export function NotificationList({ rows, total, page, pageSize }: Props) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState(rows);
  const [pending, startTransition] = useTransition();

  const handleClick = (item: NotificationView) => {
    if (item.readAt) return;
    startTransition(async () => {
      const r = await markNotificationReadAction(item.id);
      if (r.ok) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date() } : i)));
      }
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
        {t('empty')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface">
        {items.map((item) => (
          <li key={item.id}>
            <NotificationItem
              item={item}
              locale={locale === 'ar' ? 'ar' : 'en'}
              onClick={() => handleClick(item)}
            />
          </li>
        ))}
      </ul>
      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || pending}
            onClick={() => router.push(`?page=${page - 1}`)}
          >
            {t('prev')}
          </Button>
          <span className="text-brand-textMuted">{t('pageOf', { page, totalPages })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || pending}
            onClick={() => router.push(`?page=${page + 1}`)}
          >
            {t('next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
