import { AuditAction } from '@prisma/client';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { listAuditLogs } from '@/lib/admin/audit/queries';
import { requirePermission } from '@/lib/rbac/guards';

/**
 * Admin Audit Log viewer (Prompt 11 §4.6).
 *
 * Server-side paginated table with filters (date range, actor query,
 * entity type, action multi-select). CSV export hits the streaming
 * endpoint at /api/v1/admin/audit/export so even very large filtered
 * sets never load into memory client-side.
 *
 * The before/after JSON diff drawer is intentionally a v1 follow-up
 * (backlog item): the raw before/after payload is in the table cell
 * as a collapsible <details> for now.
 */
export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePermission('audit_log.read');
  const t = await getTranslations('admin.audit');
  const tImp = await getTranslations('impersonation');
  const sp = await searchParams;

  const page = Math.max(1, Number.parseInt(typeof sp.page === 'string' ? sp.page : '1', 10) || 1);
  const pageSize = 50;

  const filters = {
    from: typeof sp.from === 'string' && sp.from ? new Date(sp.from) : defaultFrom(),
    to: typeof sp.to === 'string' && sp.to ? new Date(sp.to) : undefined,
    actorQuery: typeof sp.actor === 'string' && sp.actor ? sp.actor : undefined,
    entityType: typeof sp.entityType === 'string' && sp.entityType ? sp.entityType : undefined,
    actions: Array.isArray(sp.action)
      ? (sp.action.filter((a): a is AuditAction =>
          Object.values(AuditAction).includes(a as AuditAction),
        ) as AuditAction[])
      : typeof sp.action === 'string' &&
          Object.values(AuditAction).includes(sp.action as AuditAction)
        ? [sp.action as AuditAction]
        : undefined,
  };

  const { rows, total } = await listAuditLogs(filters, { page, pageSize });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const csvQuery = new URLSearchParams();
  if (filters.from) csvQuery.set('from', filters.from.toISOString());
  if (filters.to) csvQuery.set('to', filters.to.toISOString());
  if (filters.actorQuery) csvQuery.set('actor', filters.actorQuery);
  if (filters.entityType) csvQuery.set('entityType', filters.entityType);
  if (filters.actions) for (const a of filters.actions) csvQuery.append('action', a);

  return (
    <section className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-brand-navy">{t('title')}</h1>
          <p className="text-sm text-brand-textMuted">{t('subtitle')}</p>
        </div>
        <Button asChild variant="outline">
          <a href={`/api/v1/admin/audit/export?${csvQuery.toString()}`}>{t('exportCsv')}</a>
        </Button>
      </header>

      <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="page" value="1" />
        <label className="space-y-1 text-xs">
          <span className="block text-brand-textMuted">{t('filters.from')}</span>
          <input
            type="date"
            name="from"
            defaultValue={filters.from ? filters.from.toISOString().slice(0, 10) : ''}
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block text-brand-textMuted">{t('filters.to')}</span>
          <input
            type="date"
            name="to"
            defaultValue={filters.to ? filters.to.toISOString().slice(0, 10) : ''}
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block text-brand-textMuted">{t('filters.actor')}</span>
          <input
            type="text"
            name="actor"
            defaultValue={filters.actorQuery ?? ''}
            placeholder={t('filters.actorPlaceholder')}
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block text-brand-textMuted">{t('filters.entityType')}</span>
          <input
            type="text"
            name="entityType"
            defaultValue={filters.entityType ?? ''}
            placeholder={t('filters.entityTypePlaceholder')}
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <fieldset className="space-y-1 text-xs sm:col-span-2 lg:col-span-4">
          <legend className="text-brand-textMuted">{t('filters.actions')}</legend>
          <div className="flex flex-wrap gap-2">
            {Object.values(AuditAction).map((a) => (
              <label
                key={a}
                className="flex items-center gap-1 rounded-md border border-brand-border px-2 py-1"
              >
                <input
                  type="checkbox"
                  name="action"
                  value={a}
                  defaultChecked={filters.actions?.includes(a) ?? false}
                />
                {a}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button type="submit" size="sm">
            {t('apply')}
          </Button>
        </div>
      </form>

      <p className="text-xs text-brand-textMuted">{t('count', { total, page, totalPages })}</p>

      <div className="overflow-x-auto rounded-md border border-brand-border">
        <table className="min-w-full divide-y divide-brand-border text-xs">
          <thead className="bg-brand-bg uppercase tracking-wide text-brand-textMuted">
            <tr>
              <th className="px-2 py-2 text-start">{t('columns.timestamp')}</th>
              <th className="px-2 py-2 text-start">{t('columns.actor')}</th>
              <th className="px-2 py-2 text-start">{t('columns.action')}</th>
              <th className="px-2 py-2 text-start">{t('columns.entity')}</th>
              <th className="px-2 py-2 text-start">{t('columns.diff')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border bg-brand-surface">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-2 py-2 font-mono text-[11px]">
                  {r.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-1">
                    <span>{locale === 'ar' ? r.actorFullNameAr : r.actorFullNameEn}</span>
                    {r.impersonatedUserId ? (
                      <Badge variant="muted" className="w-fit text-[10px]">
                        {tImp('via_impersonation')}
                        {': '}
                        {locale === 'ar' ? r.impersonatedFullNameAr : r.impersonatedFullNameEn}
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <Badge variant={badgeVariant(r.action)}>{r.action}</Badge>
                </td>
                <td className="px-2 py-2">
                  <span className="font-medium text-brand-navy">{r.entityType}</span>
                  <br />
                  <span className="font-mono text-[10px] text-brand-textMuted">{r.entityId}</span>
                </td>
                <td className="px-2 py-2">
                  {r.beforeJson || r.afterJson ? (
                    <details>
                      <summary className="cursor-pointer text-brand-cyan">{t('viewDiff')}</summary>
                      <pre className="mt-1 max-w-md overflow-x-auto rounded-sm bg-brand-bg p-2 text-[10px]">
                        {r.beforeJson ? `BEFORE\n${r.beforeJson}\n\n` : ''}
                        {r.afterJson ? `AFTER\n${r.afterJson}` : ''}
                      </pre>
                    </details>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-brand-textMuted">
                  {t('empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-end gap-2 text-xs">
          {page > 1 ? (
            <a
              href={`?${withPage(sp, page - 1)}`}
              className="rounded-md border border-brand-border px-3 py-1 hover:bg-brand-bg"
            >
              {t('prev')}
            </a>
          ) : null}
          <span>
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <a
              href={`?${withPage(sp, page + 1)}`}
              className="rounded-md border border-brand-border px-3 py-1 hover:bg-brand-bg"
            >
              {t('next')}
            </a>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}

function defaultFrom(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function badgeVariant(a: AuditAction): 'cyan' | 'muted' | 'destructive' {
  switch (a) {
    case AuditAction.DELETE:
      return 'destructive';
    case AuditAction.READ_SENSITIVE:
      return 'muted';
    default:
      return 'cyan';
  }
}

function withPage(sp: Record<string, string | string[]>, page: number): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page') continue;
    if (Array.isArray(v)) for (const x of v) params.append(k, x);
    else params.set(k, v);
  }
  params.set('page', String(page));
  return params.toString();
}
