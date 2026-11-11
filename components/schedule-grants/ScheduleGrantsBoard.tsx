'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  createScheduleGrantAction,
  deleteScheduleGrantAction,
} from '@/lib/schedule-grants/actions';
import type { ScheduleGrantRow } from '@/lib/schedule-grants/queries';

interface Clinician {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  role: string;
}

/**
 * P64 #4 — «صلاحيات رؤية الجداول». Admin + Secretary pick a therapist (the
 * viewer) and a colleague (the owner); the viewer then sees the owner's
 * calendar beside their own, read-only. One row per pair, revocable.
 */
export function ScheduleGrantsBoard({
  grants,
  clinicians,
}: {
  grants: ScheduleGrantRow[];
  clinicians: Clinician[];
}) {
  const t = useTranslations('scheduleGrants');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [viewerId, setViewerId] = useState('');
  const [ownerId, setOwnerId] = useState('');

  const name = (p: { fullNameEn: string; fullNameAr: string }) =>
    locale === 'ar' ? p.fullNameAr || p.fullNameEn : p.fullNameEn || p.fullNameAr;
  const therapists = clinicians.filter((c) => c.role === 'THERAPIST');
  const alreadyGranted = useMemo(
    () => new Set(grants.filter((g) => g.viewer.id === viewerId).map((g) => g.owner.id)),
    [grants, viewerId],
  );
  const owners = clinicians.filter((c) => c.id !== viewerId && !alreadyGranted.has(c.id));

  const byViewer = useMemo(() => {
    const map = new Map<string, { viewer: ScheduleGrantRow['viewer']; rows: ScheduleGrantRow[] }>();
    for (const g of grants) {
      const entry = map.get(g.viewer.id) ?? { viewer: g.viewer, rows: [] };
      entry.rows.push(g);
      map.set(g.viewer.id, entry);
    }
    return [...map.values()];
  }, [grants]);

  const add = () =>
    startTransition(async () => {
      const r = await createScheduleGrantAction({ viewerId, ownerId });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('added'));
      setOwnerId('');
      router.refresh();
    });

  const revoke = (grantId: string) =>
    startTransition(async () => {
      const r = await deleteScheduleGrantAction({ grantId });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('revoked'));
      router.refresh();
    });

  const selectClass =
    'h-10 w-full rounded-md border border-brand-border bg-brand-surface px-2 text-sm text-brand-text';

  return (
    <section className="space-y-6 p-4 sm:p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
        <p className="text-sm text-brand-textMuted">{t('subtitle')}</p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="space-y-1 text-sm">
            <span className="text-brand-textMuted">{t('viewer')}</span>
            <select
              className={selectClass}
              value={viewerId}
              onChange={(e) => {
                setViewerId(e.target.value);
                setOwnerId('');
              }}
            >
              <option value="">{t('choose')}</option>
              {therapists.map((c) => (
                <option key={c.id} value={c.id}>
                  {name(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-brand-textMuted">{t('owner')}</span>
            <select
              className={selectClass}
              value={ownerId}
              disabled={!viewerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">{t('choose')}</option>
              {owners.map((c) => (
                <option key={c.id} value={c.id}>
                  {name(c)}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" onClick={add} disabled={!viewerId || !ownerId || pending}>
            {t('add')}
          </Button>
        </CardContent>
      </Card>

      {byViewer.length === 0 ? (
        <p className="text-sm text-brand-textMuted">{t('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {byViewer.map(({ viewer, rows }) => (
            <li
              key={viewer.id}
              className="rounded-md border border-brand-border bg-brand-surface p-4"
            >
              <p className="mb-2 text-sm font-medium text-brand-navy">
                {t('seesLabel', { name: name(viewer) })}
              </p>
              <ul className="flex flex-wrap gap-2">
                {rows.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-2 rounded-full border border-brand-border bg-brand-bg px-3 py-1 text-sm"
                  >
                    <span>{name(g.owner)}</span>
                    <button
                      type="button"
                      onClick={() => revoke(g.id)}
                      disabled={pending}
                      aria-label={t('revoke', { name: name(g.owner) })}
                      title={t('revoke', { name: name(g.owner) })}
                      className="text-brand-textMuted hover:text-red-600"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
