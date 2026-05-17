'use client';

import { MoreHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/components/data-table/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@/i18n/navigation';
import { deactivateSpecialtyAction, deleteSpecialtyAction } from '@/lib/admin/specialties/actions';
import type { SpecialtyListRow } from '@/lib/admin/specialties/queries';

interface Props {
  rows: SpecialtyListRow[];
  total: number;
  page: number;
  pageSize: number;
  initialSearch: string;
}

export function SpecialtiesTable({ rows, total, page, pageSize, initialSearch }: Props) {
  const t = useTranslations('admin.specialties');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
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

  const onError = (msgEn: string, msgAr: string) => toast.error(locale === 'ar' ? msgAr : msgEn);

  const handleDeactivate = (id: string) =>
    startTransition(async () => {
      const r = await deactivateSpecialtyAction(id);
      if (!r.ok) {
        onError(r.error.message_en, r.error.message_ar);
        return;
      }
      toast.success(t('deactivatedToast'));
      router.refresh();
    });

  const handleDelete = (id: string) =>
    startTransition(async () => {
      const r = await deleteSpecialtyAction(id);
      if (!r.ok) {
        onError(r.error.message_en, r.error.message_ar);
        return;
      }
      toast.success(t('deletedToast'));
      router.refresh();
    });

  return (
    <DataTable<SpecialtyListRow, unknown>
      columns={[
        {
          id: 'name',
          accessorKey: 'nameEn',
          header: t('nameEn'),
          cell: ({ row }) => (
            <div className="flex flex-col">
              <span className="font-medium text-brand-navy">
                {locale === 'ar' ? row.original.nameAr : row.original.nameEn}
              </span>
              {row.original.description ? (
                <span className="line-clamp-1 text-xs text-brand-textMuted">
                  {row.original.description}
                </span>
              ) : null}
            </div>
          ),
        },
        {
          id: 'users',
          accessorKey: 'usersCount',
          header: t('usersCount'),
          cell: ({ row }) => <span>{row.original.usersCount}</span>,
        },
        {
          id: 'active',
          accessorKey: 'active',
          header: t('active'),
          cell: ({ row }) =>
            row.original.active ? (
              <Badge variant="teal">{t('active')}</Badge>
            ) : (
              <Badge variant="muted">{tCommon('no')}</Badge>
            ),
        },
      ]}
      data={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      loading={pending}
      search={initialSearch}
      onSearchChange={(v) =>
        startTransition(() => router.replace(buildHref({ q: v || undefined, page: '1' })))
      }
      onPageChange={(p) => router.replace(buildHref({ page: String(p) }))}
      emptyMessage={t('noSpecialties')}
      emptyAction={
        <Button asChild size="sm">
          <Link href="/admin/specialties/new">{t('newSpecialty')}</Link>
        </Button>
      }
      renderRowActions={(specialty) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/specialties/${specialty.id}/edit`}>{tCommon('edit')}</Link>
            </DropdownMenuItem>
            {specialty.active ? (
              <DropdownMenuItem onSelect={() => handleDeactivate(specialty.id)}>
                {t('deactivate')}
              </DropdownMenuItem>
            ) : null}
            {specialty.usersCount === 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <ConfirmDialog
                    title={t('delete')}
                    description={t('confirmDelete')}
                    variant="destructive"
                    onConfirm={() => handleDelete(specialty.id)}
                    trigger={
                      <div className="w-full cursor-pointer text-start text-sm text-destructive">
                        {t('delete')}
                      </div>
                    }
                  />
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  );
}
