'use client';

import { MoreHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { toast } from 'sonner';

import { DataTable } from '@/components/data-table/DataTable';
import { ActAsButton } from '@/components/impersonation/ActAsButton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import {
  archiveUserAction,
  forceResetPasswordAction,
  restoreUserAction,
} from '@/lib/admin/users/actions';
import type { UserListRow } from '@/lib/admin/users/queries';

interface Props {
  rows: UserListRow[];
  total: number;
  page: number;
  pageSize: number;
  initialSearch: string;
}

export function UsersTable({ rows, total, page, pageSize, initialSearch }: Props) {
  const t = useTranslations('admin.users');
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

  const handleArchive = (id: string) =>
    startTransition(async () => {
      const r = await archiveUserAction(id);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('archivedToast'));
      router.refresh();
    });

  const handleRestore = (id: string) =>
    startTransition(async () => {
      const r = await restoreUserAction(id);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('restoredToast'));
      router.refresh();
    });

  const handleReset = (id: string) =>
    startTransition(async () => {
      const r = await forceResetPasswordAction(id);
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(`${t('resetToast')} — ${r.data.tempPassword}`);
      router.refresh();
    });

  return (
    <DataTable<UserListRow, unknown>
      columns={[
        {
          id: 'name',
          accessorKey: 'fullNameEn',
          header: t('fullNameEn'),
          cell: ({ row }) => {
            const u = row.original;
            const name = locale === 'ar' ? u.fullNameAr : u.fullNameEn;
            const initials = name
              .split(/\s+/)
              .filter(Boolean)
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();
            return (
              <div className="flex items-center gap-2">
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="font-medium text-brand-navy">{name}</span>
                  <span className="text-xs text-brand-textMuted">{u.email}</span>
                </div>
              </div>
            );
          },
        },
        {
          id: 'role',
          accessorKey: 'role',
          header: t('role'),
          cell: ({ row }) => <Badge variant="cyan">{row.original.role}</Badge>,
        },
        {
          id: 'phone',
          accessorKey: 'phone',
          header: t('fullNameEn'),
          cell: ({ row }) => <span className="font-mono text-xs">{row.original.phone}</span>,
        },
        {
          id: 'specialties',
          accessorKey: 'specialties',
          header: t('specialties'),
          enableSorting: false,
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-1">
              {row.original.specialties.map((s) => (
                <Badge key={s.id} variant="muted" className="text-[10px]">
                  {locale === 'ar' ? s.nameAr : s.nameEn}
                </Badge>
              ))}
            </div>
          ),
        },
        {
          id: 'status',
          accessorKey: 'archived',
          header: t('status'),
          cell: ({ row }) =>
            row.original.archived ? (
              <Badge variant="muted">{t('archived')}</Badge>
            ) : (
              <Badge variant="teal">{t('active')}</Badge>
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
      emptyMessage={t('noUsers')}
      emptyAction={
        <Button asChild size="sm">
          <Link href="/admin/users/new">{t('newUser')}</Link>
        </Button>
      }
      renderRowActions={(user) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/users/${user.id}/edit`}>{tCommon('edit')}</Link>
            </DropdownMenuItem>
            {/* Admin Impersonation entry point. The button itself rejects
                Admin-on-Admin server-side; here we also hide the menu item
                so it never appears for fellow admins (a non-Admin user can
                always be impersonated, archived or not). */}
            {user.role !== 'ADMIN' ? (
              <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                <ActAsButton
                  targetUserId={user.id}
                  targetName={locale === 'ar' ? user.fullNameAr : user.fullNameEn}
                />
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {user.archived ? (
              <DropdownMenuItem onSelect={() => handleRestore(user.id)}>
                {t('restore')}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem asChild>
                  <ConfirmDialog
                    title={t('forceReset')}
                    description={t('confirmReset')}
                    onConfirm={() => handleReset(user.id)}
                    trigger={
                      <div className="w-full cursor-pointer text-start text-sm">
                        {t('forceReset')}
                      </div>
                    }
                  />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <ConfirmDialog
                    title={t('archive')}
                    description={t('confirmArchive')}
                    variant="destructive"
                    onConfirm={() => handleArchive(user.id)}
                    trigger={
                      <div className="w-full cursor-pointer text-start text-sm text-destructive">
                        {t('archive')}
                      </div>
                    }
                  />
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  );
}
