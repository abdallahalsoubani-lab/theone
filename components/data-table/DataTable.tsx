'use client';

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronUp, Eye, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { DirectionalIcon } from '@/components/ui/DirectionalIcon';
import { formatNumber } from '@/lib/format/number';
import { cn } from '@/lib/utils';

/**
 * Project-wide DataTable wrapper around TanStack Table.
 *
 * Features (Prompt 5 §4.2):
 *   - Sortable headers (one column at a time)
 *   - Column-visibility dropdown
 *   - Server-side search via `onSearchChange`
 *   - Server-side pagination via page / pageSize / total / onPageChange
 *   - Per-row actions slot (renderRowActions returning a DropdownMenu)
 *   - Localized empty + loading states with optional CTA
 *
 * The component is intentionally unstyled around the data — every admin list
 * page composes its own header (title + "New" button) above this.
 */
export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  search?: string;
  onSearchChange?: (value: string) => void;
  onPageChange?: (page: number) => void;
  renderRowActions?: (row: TData) => ReactNode;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  total,
  page,
  pageSize,
  loading,
  search,
  onSearchChange,
  onPageChange,
  renderRowActions,
  emptyMessage,
  emptyAction,
  className,
}: DataTableProps<TData, TValue>) {
  const t = useTranslations('common');
  const locale = useLocale();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const appLocale = locale === 'ar' ? 'ar' : 'en';

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {onSearchChange ? (
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-brand-textMuted" />
            <Input
              type="search"
              value={search ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('search')}
              className="ps-8"
            />
          </div>
        ) : null}
        <div className="ms-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Eye className="size-4" />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((c) => c.getCanHide())
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={col.getIsVisible()}
                    onCheckedChange={(v) => col.toggleVisibility(Boolean(v))}
                  >
                    {String(col.id)}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-brand-border bg-brand-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-brand-border bg-brand-bg text-xs uppercase tracking-wider text-brand-textMuted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-3 py-2 text-start font-medium">
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-brand-navy"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === 'asc' ? (
                          <ChevronUp className="size-3" />
                        ) : h.column.getIsSorted() === 'desc' ? (
                          <ChevronDown className="size-3" />
                        ) : null}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                ))}
                {renderRowActions ? <th className="px-3 py-2" /> : null}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skel-${i}`} className="border-b border-brand-border last:border-b-0">
                  {columns.map((_c, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-3 w-full animate-pulse rounded bg-brand-bg" />
                    </td>
                  ))}
                  {renderRowActions ? <td className="px-3 py-3" /> : null}
                </tr>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (renderRowActions ? 1 : 0)}
                  className="px-3 py-10 text-center text-brand-textMuted"
                >
                  <div className="space-y-2">
                    <p>{emptyMessage ?? t('loading')}</p>
                    {emptyAction}
                  </div>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-brand-border last:border-b-0">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 text-brand-text">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  {renderRowActions ? (
                    <td className="px-3 py-2 text-end">{renderRowActions(row.original)}</td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {onPageChange ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-brand-textMuted">
          <p>
            Showing {formatNumber(from, appLocale)}–{formatNumber(to, appLocale)} of{' '}
            {formatNumber(total, appLocale)}
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Previous page"
            >
              <DirectionalIcon name="chevron-start" className="size-4" />
            </Button>
            <span className="px-2">
              {formatNumber(page, appLocale)} / {formatNumber(pages, appLocale)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Next page"
            >
              <DirectionalIcon name="chevron-end" className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
