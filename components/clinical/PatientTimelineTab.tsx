'use client';

import {
  Activity,
  Calendar,
  ClipboardList,
  FileText,
  MessageSquare,
  Stethoscope,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import type { TimelineEntry, TimelineEntryKind } from '@/lib/clinical/timeline/types';

interface Props {
  entries: TimelineEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const ICONS: Record<TimelineEntryKind, typeof Activity> = {
  INTAKE: ClipboardList,
  APPOINTMENT: Calendar,
  PLAN_CREATED: Stethoscope,
  PLAN_PROPOSED: Stethoscope,
  PLAN_APPROVED: Stethoscope,
  PLAN_REJECTED: Stethoscope,
  PLAN_PAUSED: Stethoscope,
  PLAN_COMPLETED: Stethoscope,
  PLAN_DISCONTINUED: Stethoscope,
  PLAN_SUPERSEDED: Stethoscope,
  SESSION_NOTE: FileText,
  SESSION_NOTE_ADDENDUM: FileText,
  DAY_REPORT: MessageSquare,
  DOCTOR_REVIEW: MessageSquare,
};

/**
 * Read-only patient timeline view (Prompt 9 §4.11.2).
 *
 * Renders a vertical timeline of clinical events with a date separator
 * per day. Search box pushes the query string back into the URL so
 * the server re-renders with filtered entries; pagination chips do
 * the same. No mutations from this surface — the timeline is the
 * clinical narrative, not an editing canvas.
 */
export function PatientTimelineTab({ entries, total, page, pageSize }: Props) {
  const t = useTranslations('clinical.timeline');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    params.delete('page');
    router.push(`?${params.toString()}`);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const localeTag = locale === 'ar' ? 'ar' : 'en';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-brand-border bg-brand-surface p-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-brand-textMuted">
          {t('search')}
          <Input
            defaultValue={sp.get('q') ?? ''}
            placeholder={t('searchPlaceholder')}
            onBlur={(e) => setParam('q', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('from')}
          <Input
            type="date"
            defaultValue={sp.get('from') ?? ''}
            onChange={(e) => setParam('from', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('to')}
          <Input
            type="date"
            defaultValue={sp.get('to') ?? ''}
            onChange={(e) => setParam('to', e.target.value)}
          />
        </label>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
          {t('empty')}
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => {
            const Icon = ICONS[e.kind] ?? Activity;
            return (
              <li
                key={e.id}
                className="flex gap-3 rounded-md border border-brand-border bg-brand-surface p-3"
              >
                <div className="mt-0.5 rounded-md bg-brand-bg p-2 text-brand-cyan">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-brand-navy">{e.title}</p>
                    <p className="text-xs text-brand-textMuted">
                      {e.occurredAt.toLocaleString(localeTag)}
                    </p>
                  </div>
                  {e.author ? <p className="text-xs text-brand-textMuted">{e.author}</p> : null}
                  {e.body ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-brand-text">{e.body}</p>
                  ) : null}
                  {e.linkPath ? (
                    <Link
                      href={e.linkPath as `/${string}`}
                      className="mt-1 inline-block text-xs text-brand-cyan hover:underline"
                    >
                      {t('open')}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}
          >
            {t('prev')}
          </Button>
          <span className="text-brand-textMuted">{t('pageOf', { page, totalPages })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setParam('page', String(page + 1))}
          >
            {t('next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
