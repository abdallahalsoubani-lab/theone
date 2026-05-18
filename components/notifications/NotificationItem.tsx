'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

export interface NotificationView {
  id: string;
  type: string;
  titleKey: string;
  bodyKey: string;
  params: Record<string, string>;
  linkPath: string | null;
  readAt: Date | null;
  createdAt: Date;
}

interface Props {
  item: NotificationView;
  locale: 'en' | 'ar';
  onClick: () => void;
}

/**
 * One row in the notification dropdown / list.
 *
 * The title and body are localized via the i18n keys carried on the row.
 * Params are interpolated into the localized template (next-intl supports
 * ICU placeholders like `{patientName}` out of the box).
 *
 * Click behavior: mark-read on click (deferred to the parent for state
 * sync), then navigate to `linkPath` if present. If absent the click is
 * still useful — it marks the row read.
 */
export function NotificationItem({ item, locale, onClick }: Props) {
  // titleKey is e.g. "notifications.types.PLAN_ASSIGNED.title". next-intl's
  // useTranslations() takes the *namespace*, so split off the leaf.
  const segments = item.titleKey.split('.');
  const leaf = segments.pop() ?? '';
  const namespace = segments.join('.');
  const bodyLeaf = item.bodyKey.split('.').pop() ?? '';
  const t = useTranslations(namespace);
  const formatter = new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const inner = (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-2 text-sm',
        item.readAt ? 'text-brand-textMuted' : 'bg-brand-bg/40 text-brand-text hover:bg-brand-bg',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          item.readAt ? 'bg-transparent' : 'bg-brand-cyan',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-brand-navy">{t(leaf, item.params)}</div>
        <div className="line-clamp-2 text-xs text-brand-textMuted">{t(bodyLeaf, item.params)}</div>
        <div className="mt-1 text-[10px] text-brand-textMuted">
          {formatter.format(item.createdAt)}
        </div>
      </div>
    </div>
  );

  if (item.linkPath) {
    return (
      <Link
        href={item.linkPath as `/${string}`}
        onClick={onClick}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan"
    >
      {inner}
    </button>
  );
}
