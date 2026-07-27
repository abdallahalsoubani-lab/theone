'use client';

import { LeaveType } from '@prisma/client';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addLeaveForUserAction } from '@/lib/leave/actions';

export interface LeaveClinicianOption {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
}

interface Props {
  /** When set, the leave is added for this user and no picker is shown
   *  (users-row menu path). Otherwise `clinicians` feeds the picker. */
  fixedUserId?: string;
  clinicians?: LeaveClinicianOption[];
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Inline "add a leave for a staff member" form (Prompt 55 §1). Direct add —
 * the leave lands APPROVED in one step; the server action enforces
 * `leaves.create` (Admin + Secretary).
 */
export function LeaveAddForm({ fixedUserId, clinicians, onDone, onCancel }: Props) {
  const t = useTranslations('leave');
  const tTypes = useTranslations('leave.types');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [userId, setUserId] = useState(fixedUserId ?? '');
  const [leaveType, setLeaveType] = useState<LeaveType>(LeaveType.VACATION);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');

  function submit() {
    startTransition(async () => {
      const r = await addLeaveForUserAction({
        userId,
        leaveType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        note: note.trim() ? note.trim() : undefined,
      });
      if (!r.ok) {
        toast.error(locale === 'ar' ? r.error.message_ar : r.error.message_en);
        return;
      }
      if (r.data.conflictCount > 0) {
        toast.success(t('toasts.addedWithConflicts', { count: String(r.data.conflictCount) }));
      } else {
        toast.success(t('toasts.added'));
      }
      router.refresh();
      onDone();
    });
  }

  const canSubmit = Boolean(userId && startDate && endDate);

  return (
    <div className="space-y-3">
      {fixedUserId ? null : (
        <div className="space-y-1">
          <Label htmlFor="leave-user">{t('form.clinician')}</Label>
          <select
            id="leave-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="" disabled>
              —
            </option>
            {(clinicians ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {locale === 'ar' ? c.fullNameAr : c.fullNameEn}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="leave-add-type">{t('form.type')}</Label>
          <select
            id="leave-add-type"
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
        <div className="space-y-1">
          <Label htmlFor="leave-add-start">{t('form.startDate')}</Label>
          <Input
            id="leave-add-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="leave-add-end">{t('form.endDate')}</Label>
          <Input
            id="leave-add-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={startDate || undefined}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="leave-add-note">{t('form.noteOptional')}</Label>
        <textarea
          id="leave-add-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t('actions.cancel')}
        </Button>
        <Button type="button" disabled={!canSubmit || pending} onClick={submit}>
          {pending ? t('form.saving') : t('form.save')}
        </Button>
      </div>
    </div>
  );
}
