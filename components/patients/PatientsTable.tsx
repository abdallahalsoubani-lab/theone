'use client';

import { Eye, MoreHorizontal, Pencil } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';

import { DataTable } from '@/components/data-table/DataTable';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from '@/i18n/navigation';
import { patientDisplayName } from '@/lib/format/patientName';
import { formatPhone } from '@/lib/format/phone';
import type { PatientListRow } from '@/lib/patients/queries';

interface Props {
  rows: PatientListRow[];
  total: number;
  page: number;
  pageSize: number;
  initialSearch: string;
  /** Path prefix for the role-specific patient routes. */
  basePath: '/secretary/patients' | '/admin/patients' | '/doctor/patients' | '/therapist/patients';
  /** Secretary/Admin can add new patients; doctor/therapist cannot. */
  canCreate: boolean;
  /** Secretary/Admin can edit profile inline; clinical roles read-only. */
  canEdit: boolean;
  /** NI-5 (Prompt 41): show the "Awaiting doctor visit" chip — secretary,
   *  admin, and doctor lists only (therapists don't see it). */
  showFirstVisitBadge?: boolean;
}

export function PatientsTable({
  rows,
  total,
  page,
  pageSize,
  initialSearch,
  basePath,
  canCreate,
  canEdit,
  showFirstVisitBadge = false,
}: Props) {
  const t = useTranslations('patients.list');
  const tFirstVisit = useTranslations('patients.firstVisit');
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

  return (
    <DataTable<PatientListRow, unknown>
      columns={[
        {
          id: 'name',
          accessorKey: 'fullNameEn',
          header: t('columnName'),
          cell: ({ row }) => {
            const p = row.original;
            const name = patientDisplayName(p.fullNameEn, p.fullNameAr, locale);

            const initials = name
              .split(/\s+/)
              .filter(Boolean)
              .map((s) => s[0])
              .slice(0, 2)
              .join('')
              .toUpperCase();
            return (
              <Link
                href={`${basePath}/${p.id}`}
                className="flex items-center gap-2 hover:underline"
              >
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="font-medium text-brand-navy">{name}</span>
                  {/* NI-5 soft flag (Prompt 41): calm chip until the first
                      COMPLETED doctor visit. */}
                  {showFirstVisitBadge && p.pendingFirstVisit ? (
                    <Badge
                      variant="outline"
                      className="mt-0.5 w-fit border-amber-400/60 bg-amber-50 text-[10px] text-amber-800"
                    >
                      {tFirstVisit('awaitingBadge')}
                    </Badge>
                  ) : null}
                </div>
              </Link>
            );
          },
        },
        {
          id: 'age',
          accessorKey: 'ageYears',
          header: t('columnAge'),
          cell: ({ row }) => <span>{row.original.ageYears ?? '\u2014'}</span>,
        },
        {
          id: 'gender',
          accessorKey: 'gender',
          header: t('columnGender'),
          cell: ({ row }) => (
            <Badge variant="muted" className="text-[10px]">
              {row.original.gender === 'MALE' ? 'M' : 'F'}
            </Badge>
          ),
        },
        {
          id: 'phone',
          accessorKey: 'phone',
          header: t('columnPhone'),
          cell: ({ row }) =>
            row.original.phone ? (
              <span className="font-mono text-xs" dir="ltr">
                {formatPhone(row.original.phone)}
              </span>
            ) : (
              // Null for Doctor/Therapist viewers (Prompt 15 §1).
              <span className="text-xs text-brand-textMuted">{tCommon('hidden')}</span>
            ),
        },
        {
          id: 'therapist',
          accessorKey: 'therapists',
          header: t('columnAssignedTherapist'),
          enableSorting: false,
          cell: ({ row }) => {
            const therapists = row.original.therapists;
            return therapists.length > 0 ? (
              <span>
                {therapists
                  .map((th) => (locale === 'ar' ? th.fullNameAr : th.fullNameEn))
                  .join('، ')}
              </span>
            ) : (
              <span className="text-brand-textMuted">—</span>
            );
          },
        },
        {
          id: 'intake',
          accessorKey: 'intakeCount',
          header: t('columnIntake'),
          cell: ({ row }) => {
            const p = row.original;
            if (p.intakeCount === 0) {
              return <Badge variant="muted">{t('intakePending')}</Badge>;
            }
            if (p.intakeCount > 1) {
              return <Badge variant="cyan">{t('intakeMultiple')}</Badge>;
            }
            return p.hasCompletedIntake ? (
              <Badge variant="teal">{t('intakeCompleted')}</Badge>
            ) : (
              <Badge variant="muted">{t('intakePending')}</Badge>
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
      onSearchChange={(v) =>
        startTransition(() => router.replace(buildHref({ q: v || undefined, page: '1' })))
      }
      onPageChange={(p) => router.replace(buildHref({ page: String(p) }))}
      emptyMessage={t('noPatients')}
      emptyAction={
        canCreate ? (
          <Button asChild size="sm">
            <Link href={`${basePath}/new`}>{t('newPatient')}</Link>
          </Button>
        ) : undefined
      }
      renderRowActions={(p) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`${basePath}/${p.id}`}>
                <Eye className="me-2 size-4" />
                {t('open')}
              </Link>
            </DropdownMenuItem>
            {canEdit ? (
              <DropdownMenuItem asChild>
                <Link href={`${basePath}/${p.id}/edit`}>
                  <Pencil className="me-2 size-4" />
                  {t('editProfile')}
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canCreate ? (
              <DropdownMenuItem asChild>
                <Link href={`${basePath}/${p.id}/intake/new`}>{t('addIntake')}</Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    />
  );
}
