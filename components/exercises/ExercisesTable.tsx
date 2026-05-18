'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from '@/i18n/navigation';
import { archiveExerciseAction, restoreExerciseAction } from '@/lib/exercises/actions';
import type { ExerciseRow } from '@/lib/exercises/queries';
import {
  ANATOMICAL_REGIONS,
  EXERCISE_CATEGORIES,
  labelForCategory,
  labelForRegion,
} from '@/lib/exercises/taxonomy';

interface Props {
  rows: ExerciseRow[];
  total: number;
  page: number;
  pageSize: number;
  /** True when the page is showing the archived tab. */
  showArchived: boolean;
  /** Admin only — controls visibility of the archive button. */
  canArchive: boolean;
}

/**
 * Library table. Filters are URL-driven so the server re-renders with
 * fresh data on each change — no client cache to drift. Row actions
 * (View / Edit / Archive / Restore) are role-gated.
 */
export function ExercisesTable({ rows, total, page, pageSize, showArchived, canArchive }: Props) {
  const t = useTranslations('clinical.exercises');
  const locale = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    params.delete('page');
    router.push(`?${params.toString()}`);
  }

  function setTab(archived: boolean) {
    const params = new URLSearchParams(sp.toString());
    if (archived) params.set('archived', '1');
    else params.delete('archived');
    params.delete('page');
    router.push(`?${params.toString()}`);
  }

  function handleArchive(id: string) {
    startTransition(async () => {
      const r = await archiveExerciseAction(id);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('archivedToast'));
      router.refresh();
    });
  }

  function handleRestore(id: string) {
    startTransition(async () => {
      const r = await restoreExerciseAction(id);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('restoredToast'));
      router.refresh();
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-brand-border">
        <button
          type="button"
          className={`border-b-2 px-3 py-1.5 text-sm ${
            !showArchived
              ? 'border-brand-cyan text-brand-navy'
              : 'border-transparent text-brand-textMuted hover:text-brand-navy'
          }`}
          onClick={() => setTab(false)}
        >
          {t('tabActive')}
        </button>
        <button
          type="button"
          className={`border-b-2 px-3 py-1.5 text-sm ${
            showArchived
              ? 'border-brand-cyan text-brand-navy'
              : 'border-transparent text-brand-textMuted hover:text-brand-navy'
          }`}
          onClick={() => setTab(true)}
        >
          {t('tabArchived')}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-brand-border bg-brand-surface p-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-brand-textMuted">
          {t('search')}
          <Input
            defaultValue={sp.get('q') ?? ''}
            placeholder={t('searchPlaceholder')}
            onBlur={(e) => setParam('q', e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('category')}
          <select
            defaultValue={sp.get('cat') ?? ''}
            onChange={(e) => setParam('cat', e.target.value)}
            className="h-8 rounded-md border border-brand-border bg-brand-surface px-2 text-sm"
          >
            <option value="">{t('all')}</option>
            {EXERCISE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {locale === 'ar' ? c.labelAr : c.labelEn}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('anatomicalRegion')}
          <select
            defaultValue={sp.get('reg') ?? ''}
            onChange={(e) => setParam('reg', e.target.value)}
            className="h-8 rounded-md border border-brand-border bg-brand-surface px-2 text-sm"
          >
            <option value="">{t('all')}</option>
            {ANATOMICAL_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {locale === 'ar' ? r.labelAr : r.labelEn}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-brand-border bg-brand-surface p-12 text-center text-sm text-brand-textMuted">
          {showArchived ? t('emptyArchived') : t('empty')}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const name = locale === 'ar' ? row.nameAr : row.nameEn;
            return (
              <li
                key={row.id}
                className="overflow-hidden rounded-md border border-brand-border bg-brand-surface"
              >
                {row.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={row.imageUrl} alt="" className="h-32 w-full object-cover" />
                ) : (
                  <div className="flex h-32 w-full items-center justify-center bg-brand-bg text-xs text-brand-textMuted">
                    {t('noImage')}
                  </div>
                )}
                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/clinical/exercises/${row.id}` as `/${string}`}
                      className="font-medium text-brand-navy hover:underline"
                    >
                      {name}
                    </Link>
                    <span className="font-mono text-xs text-brand-textMuted">v{row.version}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="muted">
                      {labelForCategory(row.category, locale === 'ar' ? 'ar' : 'en')}
                    </Badge>
                    <Badge variant="outline">
                      {labelForRegion(row.anatomicalRegion, locale === 'ar' ? 'ar' : 'en')}
                    </Badge>
                    {row.videoUrl ? <Badge variant="default">{t('hasVideo')}</Badge> : null}
                    {row.contraindications ? (
                      <Badge variant="destructive">{t('contra')}</Badge>
                    ) : null}
                  </div>
                  <div className="flex justify-end gap-1">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/clinical/exercises/${row.id}` as `/${string}`}>
                        {t('view')}
                      </Link>
                    </Button>
                    {!showArchived ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/clinical/exercises/${row.id}/edit` as `/${string}`}>
                          {t('edit')}
                        </Link>
                      </Button>
                    ) : null}
                    {canArchive ? (
                      showArchived ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestore(row.id)}
                          disabled={pending}
                        >
                          {t('restore')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleArchive(row.id)}
                          disabled={pending}
                        >
                          {t('archive')}
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
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
