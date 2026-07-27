'use client';

import { LeaveStatus } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { LeaveAddForm, type LeaveClinicianOption } from '@/components/leave/LeaveAddForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/format/date';
import { approveLeaveAction, deleteLeaveAction, rejectLeaveAction } from '@/lib/leave/actions';
import type { LeaveRow } from '@/lib/leave/queries';
import { leaveStatusVariant } from '@/lib/leave/status-variant';

interface Props {
  rows: LeaveRow[];
  /** Approve / reject pending requests — `leaves.update` (Admin). */
  canApprove: boolean;
  /** Direct add + delete — `leaves.create` / `leaves.delete` (Admin + Secretary, Prompt 55 §1). */
  canManage: boolean;
  clinicians: LeaveClinicianOption[];
}

/**
 * All-staff leaves board, shared by /admin/leaves and /secretary/leaves
 * (Prompt 55 §1). Pending requests keep the approval workflow; `canManage`
 * adds the direct add button and per-row delete ("end early").
 */
export function LeavesBoard({ rows, canApprove, canManage, clinicians }: Props) {
  const t = useTranslations('leave');
  const tStatus = useTranslations('leave.status');
  const tType = useTranslations('leave.types');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [rejectTarget, setRejectTarget] = useState<LeaveRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const pendingRows = rows.filter((r) => r.status === LeaveStatus.PENDING);
  const otherRows = rows.filter((r) => r.status !== LeaveStatus.PENDING);

  function approve(row: LeaveRow) {
    startTransition(async () => {
      const r = await approveLeaveAction({ id: row.id });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      if (r.data.conflictCount > 0) {
        toast.success(t('toasts.approvedWithConflicts', { count: String(r.data.conflictCount) }));
      } else {
        toast.success(t('toasts.approved'));
      }
      router.refresh();
    });
  }

  function remove(row: LeaveRow) {
    startTransition(async () => {
      const r = await deleteLeaveAction({ id: row.id });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('toasts.deleted'));
      router.refresh();
    });
  }

  function submitReject() {
    if (!rejectTarget) return;
    startTransition(async () => {
      const r = await rejectLeaveAction({ id: rejectTarget.id, reason: rejectReason });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('toasts.rejected'));
      setRejectTarget(null);
      setRejectReason('');
      router.refresh();
    });
  }

  const deleteAction = (row: LeaveRow) =>
    canManage ? (
      <ConfirmDialog
        title={t('manage.deleteTitle')}
        description={t('manage.deleteConfirm')}
        variant="destructive"
        onConfirm={() => remove(row)}
        trigger={
          <Button type="button" size="sm" variant="outline" disabled={pending}>
            {t('manage.delete')}
          </Button>
        }
      />
    ) : null;

  return (
    <section className="space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium text-brand-navy">{t('adminTitle')}</h1>
          <p className="text-sm text-brand-textMuted">{t('adminSubtitle')}</p>
        </div>
        {canManage ? (
          <Button type="button" onClick={() => setAddOpen(true)}>
            {t('manage.addButton')}
          </Button>
        ) : null}
      </header>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-brand-navy">{tStatus('PENDING')}</h2>
        {pendingRows.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg px-4 py-3 text-sm text-brand-textMuted">
            {t('empty.pending')}
          </p>
        ) : (
          <LeaveTable
            rows={pendingRows}
            intlLocale={intlLocale}
            locale={locale}
            tColumns={t}
            tType={tType}
            tStatus={tStatus}
            renderActions={(row) => (
              <div className="flex flex-wrap gap-2">
                {canApprove ? (
                  <>
                    <Button type="button" size="sm" disabled={pending} onClick={() => approve(row)}>
                      {t('actions.approve')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setRejectTarget(row);
                        setRejectReason('');
                      }}
                    >
                      {t('actions.reject')}
                    </Button>
                  </>
                ) : null}
                {deleteAction(row)}
              </div>
            )}
          />
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-brand-navy">{t('columns.status')}</h2>
        {otherRows.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg px-4 py-3 text-sm text-brand-textMuted">
            {t('empty.all')}
          </p>
        ) : (
          <LeaveTable
            rows={otherRows}
            intlLocale={intlLocale}
            locale={locale}
            tColumns={t}
            tType={tType}
            tStatus={tStatus}
            renderActions={canManage ? (row) => deleteAction(row) : undefined}
          />
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => (o ? null : setAddOpen(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('manage.addButton')}</DialogTitle>
          </DialogHeader>
          <LeaveAddForm
            clinicians={clinicians}
            onDone={() => setAddOpen(false)}
            onCancel={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={rejectTarget !== null} onOpenChange={(o) => (o ? null : setRejectTarget(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('actions.rejectTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="reject-reason">{t('actions.rejectReason')}</Label>
            <textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              maxLength={1000}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectTarget(null)}
              disabled={pending}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || rejectReason.trim().length < 5}
              onClick={submitReject}
            >
              {pending ? t('actions.rejecting') : t('actions.rejectSave')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function LeaveTable({
  rows,
  intlLocale,
  locale,
  tColumns,
  tType,
  tStatus,
  renderActions,
}: {
  rows: LeaveRow[];
  intlLocale: 'en' | 'ar';
  locale: string;
  tColumns: (k: string) => string;
  tType: (k: string) => string;
  tStatus: (k: string) => string;
  renderActions?: (row: LeaveRow) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-brand-border">
      <table className="min-w-full divide-y divide-brand-border text-sm">
        <thead className="bg-brand-bg text-xs uppercase tracking-wide text-brand-textMuted">
          <tr>
            <th className="px-3 py-2 text-start">{tColumns('columns.user')}</th>
            <th className="px-3 py-2 text-start">{tColumns('columns.type')}</th>
            <th className="px-3 py-2 text-start">{tColumns('columns.range')}</th>
            <th className="px-3 py-2 text-start">{tColumns('columns.reason')}</th>
            <th className="px-3 py-2 text-start">{tColumns('columns.status')}</th>
            {renderActions ? (
              <th className="px-3 py-2 text-start">{tColumns('columns.actions')}</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-border bg-brand-surface">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 font-medium text-brand-navy">
                {locale === 'ar' ? r.userFullNameAr : r.userFullNameEn}
              </td>
              <td className="px-3 py-2">{tType(r.leaveType)}</td>
              <td className="px-3 py-2">
                {formatDate(r.startDate, intlLocale)} – {formatDate(r.endDate, intlLocale)}
              </td>
              <td className="px-3 py-2 text-brand-textMuted">{r.reason ?? '—'}</td>
              <td className="px-3 py-2">
                <Badge variant={leaveStatusVariant(r.status)}>{tStatus(r.status)}</Badge>
              </td>
              {renderActions ? <td className="px-3 py-2">{renderActions(r)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
