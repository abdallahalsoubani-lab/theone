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
import { deactivateRoomAction, deleteRoomAction } from '@/lib/admin/rooms/actions';
import type { RoomListRow } from '@/lib/admin/rooms/queries';

interface Props {
  rows: RoomListRow[];
  total: number;
  page: number;
  pageSize: number;
  initialSearch: string;
}

export function RoomsTable({ rows, total, page, pageSize, initialSearch }: Props) {
  const t = useTranslations('admin.rooms');
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

  const onError = (en: string, ar: string) => toast.error(locale === 'ar' ? ar : en);

  const handleDeactivate = (id: string) =>
    startTransition(async () => {
      const r = await deactivateRoomAction(id);
      if (!r.ok) {
        onError(r.error.message_en, r.error.message_ar);
        return;
      }
      toast.success(t('deactivatedToast'));
      router.refresh();
    });

  const handleDelete = (id: string) =>
    startTransition(async () => {
      const r = await deleteRoomAction(id);
      if (!r.ok) {
        onError(r.error.message_en, r.error.message_ar);
        return;
      }
      toast.success(t('deletedToast'));
      router.refresh();
    });

  return (
    <DataTable<RoomListRow, unknown>
      columns={[
        {
          id: 'name',
          accessorKey: 'name',
          header: t('name'),
          cell: ({ row }) => (
            <span className="font-medium text-brand-navy">{row.original.name}</span>
          ),
        },
        {
          id: 'future',
          accessorKey: 'futureAppointments',
          header: t('activeAppointments'),
          cell: ({ row }) => <span>{row.original.futureAppointments}</span>,
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
      emptyMessage={t('noRooms')}
      emptyAction={
        <Button asChild size="sm">
          <Link href="/admin/rooms/new">{t('newRoom')}</Link>
        </Button>
      }
      renderRowActions={(room) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/rooms/${room.id}/edit`}>{tCommon('edit')}</Link>
            </DropdownMenuItem>
            {room.active ? (
              <DropdownMenuItem onSelect={() => handleDeactivate(room.id)}>
                {t('deactivate')}
              </DropdownMenuItem>
            ) : null}
            {room.futureAppointments === 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <ConfirmDialog
                    title={t('delete')}
                    description={t('confirmDelete')}
                    variant="destructive"
                    onConfirm={() => handleDelete(room.id)}
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
