'use client';

import { Bell } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@/i18n/navigation';
import {
  getUnreadNotificationCountAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/lib/notifications/actions';

import { NotificationItem, type NotificationView } from './NotificationItem';

interface Props {
  initialUnreadCount: number;
  /**
   * Server-fetched recent notifications. The bell uses these on first
   * render (so opening the dropdown is instant). The poll updates the
   * count badge; clicking the bell re-fetches the list via router.refresh
   * — the parent layout passes the freshest list on each refresh.
   */
  initialItems: NotificationView[];
  notificationsPath: string;
  /**
   * Optional poll interval override — defaults to 60 seconds. Tests
   * pass a smaller value to verify the polling effect.
   */
  pollIntervalMs?: number;
}

/**
 * Header notification bell.
 *
 * Polls `getUnreadNotificationCountAction` every 60s to keep the badge
 * current. Clicking an item issues `markNotificationReadAction` and
 * navigates if the row has a linkPath. "Mark all read" zeroes out the
 * badge in one call.
 *
 * Polling implementation: useEffect + setInterval. Deliberately not
 * TanStack Query — see the Prompt 9 decision log; this is the smallest
 * surface that satisfies the v1 acceptance criterion ("bell shows
 * unread badge") without pulling a new client-state library.
 */
export function NotificationBell({
  initialUnreadCount,
  initialItems,
  notificationsPath,
  pollIntervalMs = 60_000,
}: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const [unread, setUnread] = useState(initialUnreadCount);
  const [items, setItems] = useState<NotificationView[]>(initialItems);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);
  useEffect(() => {
    setUnread(initialUnreadCount);
  }, [initialUnreadCount]);

  // 60-second poll. Cleared on unmount; the visibilitychange listener
  // pauses polling when the tab is hidden to avoid waking the server
  // for an unattended browser.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      const next = await getUnreadNotificationCountAction();
      if (!cancelled) setUnread(next);
    };
    const id = window.setInterval(() => void tick(), pollIntervalMs);
    // Also fire on focus so returning to the tab shows fresh state.
    const onFocus = () => void tick();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [pollIntervalMs]);

  const handleItemClick = (item: NotificationView) => {
    if (item.readAt) return; // already read; the link still navigates
    startTransition(async () => {
      const r = await markNotificationReadAction(item.id);
      if (r.ok) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date() } : i)));
        setUnread((u) => Math.max(0, u - 1));
      }
    });
  };

  const handleMarkAll = () => {
    startTransition(async () => {
      const r = await markAllNotificationsReadAction();
      if (r.ok) {
        const now = new Date();
        setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? now })));
        setUnread(0);
      }
    });
  };

  const badgeLabel = unread > 9 ? '9+' : String(unread);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('shell.notifications')}
          className="relative"
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span
              className="absolute -top-0.5 end-0 min-w-[1.25rem] rounded-full bg-brand-cyan px-1 py-0.5 text-[10px] font-semibold leading-none text-white"
              aria-label={t('notifications.unreadLabel', { count: unread })}
            >
              {badgeLabel}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[22rem] max-w-[calc(100vw-1rem)] p-0"
      >
        <div className="flex items-center justify-between border-b border-brand-border px-3 py-2">
          <span className="text-sm font-medium text-brand-navy">{t('notifications.title')}</span>
          {unread > 0 ? (
            <button
              type="button"
              className="text-xs text-brand-cyan hover:underline disabled:opacity-50"
              onClick={handleMarkAll}
              disabled={pending}
            >
              {t('notifications.markAllRead')}
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-brand-textMuted">
            {t('notifications.empty')}
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-brand-border overflow-y-auto">
            {items.slice(0, 10).map((item) => (
              <li key={item.id}>
                <NotificationItem
                  item={item}
                  locale={locale === 'ar' ? 'ar' : 'en'}
                  onClick={() => handleItemClick(item)}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-brand-border px-3 py-2 text-center">
          <Link href={notificationsPath} className="text-xs text-brand-cyan hover:underline">
            {t('notifications.viewAll')}
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
