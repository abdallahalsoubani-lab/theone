'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

import { LeaveAddForm } from '@/components/leave/LeaveAddForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate } from '@/lib/format/date';
import { deleteLeaveAction } from '@/lib/leave/actions';
import type { LeaveRow } from '@/lib/leave/queries';
import { leaveStatusVariant } from '@/lib/leave/status-variant';

interface Props {
  user: { id: string; name: string };
  /** This user's leaves only — the callers pre-filter. */
  leaves: LeaveRow[];
  trigger: ReactNode;
}

/**
 * Per-clinician leave management dialog, opened from the admin users-row
 * (...) menu (Prompt 55 §1): list + add (date range, optional note) +
 * delete / end early. Follows the ConfirmDialog trigger pattern so it can
 * sit inside a DropdownMenuItem.
 */
export function ManageLeavesDialog({ user, leaves, trigger }: Props) {
  const t = useTranslations('leave');
  const tStatus = useTranslations('leave.status');
  const tType = useTranslations('leave.types');
  const locale = useLocale();
  const intlLocale: 'en' | 'ar' = locale === 'ar' ? 'ar' : 'en';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    startTransition(async () => {
      const r = await deleteLeaveAction({ id });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('toasts.deleted'));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('manage.title', { name: user.name })}</DialogTitle>
        </DialogHeader>

        {leaves.length === 0 ? (
          <p className="rounded-md border border-brand-border bg-brand-bg px-4 py-3 text-sm text-brand-textMuted">
            {t('empty.user')}
          </p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pe-1">
            {leaves.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-border bg-brand-surface px-3 py-2 text-sm"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-brand-navy">
                    {formatDate(l.startDate, intlLocale)} – {formatDate(l.endDate, intlLocale)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-brand-textMuted">
                    <span>{tType(l.leaveType)}</span>
                    <Badge variant={leaveStatusVariant(l.status)}>{tStatus(l.status)}</Badge>
                    {l.reason ? <span className="truncate">{l.reason}</span> : null}
                  </div>
                </div>
                <ConfirmDialog
                  title={t('manage.deleteTitle')}
                  description={t('manage.deleteConfirm')}
                  variant="destructive"
                  onConfirm={() => remove(l.id)}
                  trigger={
                    <Button type="button" size="sm" variant="outline" disabled={pending}>
                      {t('manage.delete')}
                    </Button>
                  }
                />
              </div>
            ))}
          </div>
        )}

        {adding ? (
          <LeaveAddForm
            fixedUserId={user.id}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <div className="flex justify-end">
            <Button type="button" onClick={() => setAdding(true)}>
              {t('manage.addButton')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
