import type { PlanStatus } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { auth } from '@/auth';
import { Badge } from '@/components/ui/badge';
import { listPlansForDoctor } from '@/lib/clinical/plans/queries';
import {
  PLAN_LIST_STATUS_VALUES,
  type PlanListStatus,
  planListFiltersSchema,
} from '@/lib/clinical/plans/schemas';
import { formatDate } from '@/lib/format/date';
import { requirePermission } from '@/lib/rbac/guards';
import { cn } from '@/lib/utils';

type AppLocale = 'ar' | 'en';

const STATUS_BADGE: Record<PlanStatus, 'cyan' | 'teal' | 'muted' | 'outline'> = {
  ACTIVE: 'teal',
  PROPOSED: 'cyan',
  REJECTED: 'outline',
  SUPERSEDED: 'muted',
  PAUSED: 'outline',
  COMPLETED: 'muted',
  DISCONTINUED: 'outline',
};

export default async function DoctorPlansPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('treatment_plans.read.assigned', {});
  const session = await auth();
  const sp = await searchParams;
  const tList = await getTranslations('clinical.plans.list');
  const tStatus = await getTranslations('clinical.plans.status');

  const filters = planListFiltersSchema.parse({
    status: sp.status ?? 'ALL',
    search: sp.q ?? null,
    page: sp.page ?? 1,
    pageSize: 20,
  });

  const { rows, total, countsByStatus } = await listPlansForDoctor({
    doctorId: session!.user.id,
    filters,
  });

  const totalAll = Object.values(countsByStatus).reduce((sum, n) => sum + n, 0);
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const appLocale: AppLocale = locale === 'ar' ? 'ar' : 'en';

  const buildHref = (overrides: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | number | null> = {
      status: filters.status,
      q: filters.search,
      page: filters.page,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value === null || value === undefined || value === '') continue;
      if (key === 'status' && value === 'ALL') continue;
      if (key === 'page' && value === 1) continue;
      next.set(key, String(value));
    }
    const qs = next.toString();
    return qs ? `/doctor/plans?${qs}` : '/doctor/plans';
  };

  return (
    <section className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium text-brand-navy">{tList('title')}</h1>
          <Badge variant="muted">{total}</Badge>
        </div>
      </header>

      <nav
        aria-label={tList('filterByStatus')}
        className="flex flex-wrap items-center gap-2 border-b border-brand-border pb-3"
      >
        {PLAN_LIST_STATUS_VALUES.map((s) => {
          const active = filters.status === s;
          const count = s === 'ALL' ? totalAll : (countsByStatus[s as PlanStatus] ?? 0);
          const label = s === 'ALL' ? tList('statusAll') : tStatus(s as PlanStatus);
          return (
            <Link
              key={s}
              href={buildHref({ status: s as PlanListStatus, page: 1 })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
                  : 'border-brand-border bg-brand-surface text-brand-textMuted hover:border-brand-cyan/40 hover:text-brand-navy',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <span>{label}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[10px] tabular-nums',
                  active ? 'bg-brand-cyan/20' : 'bg-brand-bg',
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      <form method="get" className="flex items-center gap-2">
        <input type="hidden" name="status" value={filters.status} />
        <input
          type="text"
          name="q"
          defaultValue={filters.search ?? ''}
          placeholder={tList('searchPlaceholder')}
          className="w-full max-w-sm rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm text-brand-text placeholder:text-brand-textMuted focus:border-brand-cyan focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md border border-brand-cyan bg-brand-cyan/10 px-3 py-2 text-sm font-medium text-brand-navy transition-colors hover:bg-brand-cyan/20"
        >
          {tList('searchAction')}
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-md border border-brand-border bg-brand-bg p-6 text-sm text-brand-textMuted">
          {tList('empty')}
        </p>
      ) : (
        <ul className="divide-y divide-brand-border overflow-hidden rounded-md border border-brand-border bg-brand-surface">
          {rows.map((p) => {
            const patientName = appLocale === 'ar' ? p.patientFullNameAr : p.patientFullNameEn;
            return (
              <li key={p.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/doctor/plans/${p.id}`}
                        className="text-sm font-semibold text-brand-navy hover:underline"
                      >
                        {patientName}
                      </Link>
                      <Badge variant="outline">v{p.version}</Badge>
                      <Badge variant={STATUS_BADGE[p.status]}>{tStatus(p.status)}</Badge>
                    </div>
                    <p className="text-sm text-brand-text">{p.diagnosisPrimary}</p>
                    <p className="text-xs text-brand-textMuted">
                      {tList('schedule', {
                        freq: p.frequencyPerWeek,
                        weeks: p.durationWeeks,
                      })}
                      {' · '}
                      {tList('createdOn', {
                        date: formatDate(p.createdAt, appLocale),
                      })}
                    </p>
                    {p.proposalReason ? (
                      <p className="text-xs text-brand-textMuted">
                        <span className="font-medium">{tList('proposalReason')}:</span>{' '}
                        {p.proposalReason}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    href={`/doctor/plans/${p.id}`}
                    className="text-xs font-medium text-brand-cyan hover:underline"
                  >
                    {tList('open')} →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pageCount > 1 ? (
        <nav aria-label={tList('pagination')} className="flex items-center justify-between text-sm">
          <span className="text-brand-textMuted">
            {tList('pageOf', { page: filters.page, total: pageCount })}
          </span>
          <div className="flex items-center gap-2">
            {filters.page > 1 ? (
              <Link
                href={buildHref({ page: filters.page - 1 })}
                className="rounded-md border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-navy hover:border-brand-cyan"
              >
                {tList('previous')}
              </Link>
            ) : null}
            {filters.page < pageCount ? (
              <Link
                href={buildHref({ page: filters.page + 1 })}
                className="rounded-md border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-navy hover:border-brand-cyan"
              >
                {tList('next')}
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </section>
  );
}
