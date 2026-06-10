'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import {
  approveHomeProgramAction,
  requestHomeProgramChangesAction,
} from '@/lib/clinical/home-program/actions';
import type { PendingApprovalRow } from '@/lib/clinical/home-program/approval';

export function HomeProgramReviewCard({ row }: { row: PendingApprovalRow }) {
  const t = useTranslations('clinical.homeProgram.approval');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showChanges, setShowChanges] = useState(false);
  const [comment, setComment] = useState('');

  const patientName = locale === 'ar' ? row.patientFullNameAr : row.patientFullNameEn;
  const therapistName =
    (locale === 'ar' ? row.therapistFullNameAr : row.therapistFullNameEn) ?? '—';

  function handleApprove() {
    startTransition(async () => {
      const r = await approveHomeProgramAction(row.patientId);
      if (!r.ok) {
        toast.error(r.error.message_en);
        return;
      }
      toast.success(t('approvedToast'));
      router.refresh();
    });
  }

  function handleRequestChanges() {
    if (!comment.trim()) {
      toast.error(t('commentRequired'));
      return;
    }
    startTransition(async () => {
      const r = await requestHomeProgramChangesAction(row.patientId, comment);
      if (!r.ok) {
        toast.error(r.error.message_en);
        return;
      }
      toast.success(t('changesRequestedToast'));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-brand-navy">{patientName}</p>
            <p className="text-xs text-brand-textMuted">
              {t('submittedBy', { name: therapistName })} ·{' '}
              {t('itemCount', { count: row.itemCount })}
            </p>
          </div>
          <Link
            href={`/doctor/patients/${row.patientId}/home-program/edit` as `/${string}`}
            className="text-xs text-brand-cyan hover:underline"
          >
            {t('reviewLink')}
          </Link>
        </div>

        {showChanges ? (
          <div className="space-y-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder={t('commentPlaceholder')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={handleRequestChanges}>
                {t('sendChanges')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowChanges(false)}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={handleApprove}>
              {t('approve')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowChanges(true)}>
              {t('requestChanges')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
