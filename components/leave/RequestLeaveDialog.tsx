'use client';

import { LeaveType } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestLeaveAction } from '@/lib/leave/actions';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function RequestLeaveDialog({ open, onClose }: Props) {
  const t = useTranslations('leave');
  const tTypes = useTranslations('leave.types');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [leaveType, setLeaveType] = useState<LeaveType>(LeaveType.SICK);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  function submit() {
    startTransition(async () => {
      const r = await requestLeaveAction({
        leaveType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      toast.success(t('toasts.requested'));
      onClose();
      router.refresh();
    });
  }

  const canSubmit = startDate && endDate && reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('form.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="leave-type">{t('form.type')}</Label>
            <select
              id="leave-type"
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as LeaveType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {Object.values(LeaveType).map((tp) => (
                <option key={tp} value={tp}>
                  {tTypes(tp)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="leave-start">{t('form.startDate')}</Label>
              <Input
                id="leave-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-end">{t('form.endDate')}</Label>
              <Input
                id="leave-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="leave-reason">{t('form.reason')}</Label>
            <textarea
              id="leave-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={t('form.reasonPlaceholder')}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" disabled={!canSubmit || pending} onClick={submit}>
            {pending ? t('form.saving') : t('form.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
