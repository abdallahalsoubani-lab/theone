'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

import { DataTable } from '@/components/data-table/DataTable';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format/date';
import type { CancelledAppointmentRow } from '@/lib/appointments/queries';

interface Props {
  rows: CancelledAppointmentRow[];
  total: number;
  page: number;
  pageSize: number;
  initialSearch: string;
  therapistOptions: Array<{ id: string; fullNameEn: string; fullNameAr: string }>;
  filterFrom: string;
  filterTo: string;
  filterTherapistId: string;
}

export function CancelledAppointmentsTable({
  rows,
  total,
  page,
  pageSize,
  initialSearch,
  therapistOptions,
  filterFrom,
  filterTo,
  filterTherapistId,
}: Props) {
  const t = useTranslations('appointments.cancelledView');
  const tCat = useTranslations('calendar.cancel.categories');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const localeTag = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const buildHref = useCallback(
    (next: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined || v === '') params.delete(k);
        else params.set(k, v);
      }
      return `?${params.toString()}`;
    },
    [searchParams],
  );

  const update = (next: Record<string, string | undefined>) =>
    startTransition(() => router.replace(buildHref({ ...next, page: '1' })));

  const inputCls =
    'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('filterFrom')}
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => update({ from: e.target.value || undefined })}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('filterTo')}
          <input
            type="date"
            value={filterTo}
            onChange={(e) => update({ to: e.target.value || undefined })}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-brand-textMuted">
          {t('filterTherapist')}
          <select
            value={filterTherapistId}
            onChange={(e) => update({ therapist: e.target.value || undefined })}
            className={inputCls}
          >
            <option value="">{t('allTherapists')}</option>
            {therapistOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {localeTag === 'ar' ? c.fullNameAr : c.fullNameEn}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DataTable<CancelledAppointmentRow, unknown>
        columns={[
          {
            id: 'patient',
            accessorKey: 'patientFullNameEn',
            header: t('columnPatient'),
            cell: ({ row }) => {
              const r = row.original;
              return (
                <div>
                  <p className="font-medium text-brand-navy">
                    {localeTag === 'ar' ? r.patientFullNameAr : r.patientFullNameEn}
                  </p>
                  <p className="font-mono text-xs text-brand-textMuted" dir="ltr">
                    {r.patientPhone ?? tCommon('hidden')}
                  </p>
                </div>
              );
            },
          },
          {
            id: 'scheduled',
            accessorKey: 'startsAt',
            header: t('columnScheduled'),
            cell: ({ row }) => formatDateTime(row.original.startsAt, localeTag),
          },
          {
            id: 'therapist',
            accessorKey: 'therapistFullNameEn',
            header: t('columnTherapist'),
            enableSorting: false,
            cell: ({ row }) =>
              localeTag === 'ar'
                ? row.original.therapistFullNameAr
                : row.original.therapistFullNameEn,
          },
          {
            id: 'room',
            accessorKey: 'roomName',
            header: t('columnRoom'),
            enableSorting: false,
            cell: ({ row }) => row.original.roomName ?? '—',
          },
          {
            id: 'reason',
            accessorKey: 'cancellationCategory',
            header: t('columnReason'),
            enableSorting: false,
            cell: ({ row }) => {
              const r = row.original;
              return (
                <div className="max-w-[16rem]">
                  {r.cancellationCategory ? (
                    <Badge variant="muted">{tCat(r.cancellationCategory)}</Badge>
                  ) : null}
                  {r.cancellationNotes ? (
                    <p className="mt-1 line-clamp-2 text-xs text-brand-textMuted">
                      {r.cancellationNotes}
                    </p>
                  ) : null}
                </div>
              );
            },
          },
          {
            id: 'cancelledBy',
            accessorKey: 'cancelledAt',
            header: t('columnCancelledBy'),
            cell: ({ row }) => {
              const r = row.original;
              const by = localeTag === 'ar' ? r.cancelledByFullNameAr : r.cancelledByFullNameEn;
              return (
                <div>
                  <p className="text-sm text-brand-text">{by ?? '—'}</p>
                  {r.cancelledAt ? (
                    <p className="text-xs text-brand-textMuted">
                      {formatDateTime(r.cancelledAt, localeTag)}
                    </p>
                  ) : null}
                </div>
              );
            },
          },
        ]}
        data={rows}
        total={total}
        page={page}
        pageSize={pageSize}
        loading={pending}
        search={initialSearch}
        onSearchChange={(v) => update({ q: v || undefined })}
        onPageChange={(p) => router.replace(buildHref({ page: String(p) }))}
        emptyMessage={t('empty')}
      />
    </div>
  );
}
